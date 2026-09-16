import assert from "node:assert/strict"
import process from "node:process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { it, vi } from "vitest"
import { blockedByLock, collectionTick, completion, resultMessage, scheduledSlot } from "../tools/ai-bridge/collection-tick.mjs"

it("shanghai schedule has only 5,12,16 hours", () => {
  assert.equal(scheduledSlot(new Date("2026-09-13T21:00:00Z")), "2026-09-14T05")
  assert.equal(scheduledSlot(new Date("2026-09-14T04:00:00Z")), "2026-09-14T12")
  assert.equal(scheduledSlot(new Date("2026-09-14T08:00:00Z")), "2026-09-14T16")
  assert.equal(scheduledSlot(new Date("2026-09-14T01:00:00Z")), null)
})
it("polling does not collect except scheduled slot, once only", async () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-schedule-"))
  let calls = 0
  const worker = () => {
    calls++
    return { state: "complete" }
  }
  const request = async () => ({ job: null })
  try {
    await collectionTick(root, { request, worker, now: new Date("2026-09-14T01:00Z") })
    assert.equal(calls, 0)
    for (let i = 0;
      i < 2;
      i++) await collectionTick(root, { request, worker, now: new Date("2026-09-14T04:00Z") })
    assert.equal(calls, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
it("polling handles pending source tests even when collection is not due", async () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-source-test-tick-"))
  let sourceCalls = 0
  let workerCalls = 0
  try {
    const result = await collectionTick(root, {
      now: new Date("2026-09-14T01:00Z"),
      request: async body => body.action === "source-tests" ? { jobs: [{ sourceId: "official-tianjin" }] } : { job: null },
      worker: () => {
        workerCalls++
        return { state: "complete" }
      },
      sourceTests: async () => {
        sourceCalls++
        return { pending: 1, completed: [{ sourceId: "official-tianjin", publishable: true, testedAt: 1 }] }
      },
    })
    assert.equal(result.skipped, "not-due")
    assert.equal(sourceCalls, 1)
    assert.equal(workerCalls, 0)
    assert.equal(result.runtimeSourceTests.completed[0].sourceId, "official-tianjin")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
it("source-test polling failure does not start collection or leak raw details", async () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-source-test-tick-error-"))
  try {
    const result = await collectionTick(root, {
      now: new Date("2026-09-14T01:00Z"),
      request: async body => body.action === "source-tests" ? { jobs: [{ sourceId: "official-tianjin" }] } : { job: null },
      sourceTests: async () => {
        throw new Error("SECRET_RUNTIME_DETAIL")
      },
    })
    assert.equal(result.skipped, "not-due")
    assert.equal(result.runtimeSourceTestError, "来源运行复核未完成")
    assert.doesNotMatch(JSON.stringify(result), /SECRET_RUNTIME_DETAIL/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
it("idle polling does not spawn the source-test runner when no review is pending", async () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-source-test-empty-"))
  let sourceCalls = 0
  try {
    const result = await collectionTick(root, {
      now: new Date("2026-09-14T01:00Z"),
      request: async body => body.action === "source-tests" ? { jobs: [] } : { job: null },
      sourceTests: async () => {
        sourceCalls++
        return { pending: 0, completed: [] }
      },
    })
    assert.equal(result.skipped, "not-due")
    assert.equal(sourceCalls, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
it("manual claim is required and completion reported", async () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-manual-"))
  let calls = 0
  const events: Record<string, any>[] = []
  try {
    await collectionTick(root, { now: new Date("2026-09-14T01:00Z"), worker: () => {
      calls++
      return { state: "complete" }
    }, request: async (body) => {
      events.push(body)
      return body.action === "collection-poll" ? { job: { id: "test" } } : { claimed: true }
    } })
    assert.equal(calls, 1)
    assert.equal(events.at(-1)?.state, "complete")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
it("existing pipeline lock prevents requests and collection", async () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-busy-"))
  mkdirSync(join(root, ".data/mac-batch"), { recursive: true })
  writeFileSync(join(root, ".data/mac-batch/worker.lock"), String(process.pid))
  try {
    assert.equal((await collectionTick(root, { request: async () => {
      throw new Error("must not call")
    } })).skipped, "busy")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
it("lost finish response is retried without running collection twice", async () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-receipt-"))
  let calls = 0
  let finishes = 0
  let claimed = false
  const request = async (body: Record<string, any>) => {
    if (body.action === "collection-poll") return { job: claimed ? null : { id: "test" } }
    if (body.action === "collection-claim") {
      claimed = true
      return { claimed: true }
    }
    if (body.action === "collection-finish" && ++finishes === 1) throw new Error("network lost")
    return {}
  }
  const options = { now: new Date("2026-09-14T01:00Z"), request, worker: () => {
    calls++
    return { state: "complete" }
  } }
  try {
    await assert.rejects(collectionTick(root, options), /network lost/)
    await collectionTick(root, options)
    assert.equal(calls, 1)
    assert.equal(finishes, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
it("worker exception completes manual job as error", async () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-error-"))
  const events: Record<string, any>[] = []
  try {
    await collectionTick(root, { now: new Date("2026-09-14T01:00Z"), worker: () => {
      throw new Error("failed")
    }, request: async (body) => {
      events.push(body)
      return body.action === "collection-poll" ? { job: { id: "test" } } : { claimed: true }
    } })
    assert.equal(events.at(-1)?.state, "error")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
it("uncertain claim is reported after restart without collection", async () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-claim-loss-"))
  let collected = 0
  const finishes: Record<string, any>[] = []
  try {
    await assert.rejects(collectionTick(root, { now: new Date("2026-09-14T01:00Z"), worker: () => {
      collected++
    }, request: async (body) => {
      if (body.action === "collection-poll") return { job: { id: "uncertain" } }
      throw new Error("claim response lost")
    } }), /claim response lost/)
    await collectionTick(root, { now: new Date("2026-09-14T01:00Z"), worker: () => {
      collected++
    }, request: async (body) => {
      if (body.action === "collection-finish") finishes.push(body)
      return { job: null }
    } })
    assert.equal(collected, 0)
    assert.equal(finishes[0].state, "error")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it("dead lock is retained instead of racing with a new owner", () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-dead-lock-"))
  const lock = join(root, "lock")
  writeFileSync(lock, "12345")
  const probe = vi.spyOn(process, "kill").mockImplementation(() => {
    throw Object.assign(new Error("dead"), { code: "ESRCH" })
  })
  try {
    assert.throws(() => blockedByLock(lock), /失效采集锁/)
    assert.equal(readFileSync(lock, "utf8"), "12345")
  } finally {
    probe.mockRestore()
    rmSync(root, { recursive: true, force: true })
  }
})
it("current source errors are not reported as successful collection", () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-source-result-"))
  const dir = join(root, ".data/mac-batch")
  mkdirSync(dir, { recursive: true })
  try {
    writeFileSync(join(dir, "result.json"), JSON.stringify({ states: [{ checkedAt: 20, status: "error" }, { checkedAt: 5, status: "ok" }] }))
    assert.equal(completion(root, { state: "complete", startedAt: 10 }).state, "error")
    writeFileSync(join(dir, "result.json"), JSON.stringify({ states: [{ checkedAt: 20, status: "partial" }] }))
    assert.match(completion(root, { state: "complete", startedAt: 10 }).message, /部分成功 1 个/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it("run summary separates articles, updates, duplicates and source failures", () => {
  const states = [
    { status: "ok", collectionCounts: { discovered: 12, duplicates: 30, failed: 0 } },
    { status: "partial", collectionCounts: { discovered: 5, duplicates: 4, failed: 3 } },
    { status: "error", collectionCounts: { discovered: 0, duplicates: 0, failed: 0 } },
  ]
  assert.equal(resultMessage(states, { state: "complete", publication: { publishedArticles: 8, updatedArticles: 2 } }), "新发现 17 条 · 新发布 8 条 · 更新 2 条 · 重复跳过 34 条 · 处理失败 3 条；来源异常 1 个、部分成功 1 个")
  assert.match(resultMessage(states, { state: "error", publication: { publishedArticles: 8, updatedArticles: 2 } }), /发布条数未确认/)
  assert.match(resultMessage([{ status: "ok" }], { state: "complete" }), /本轮采集条数未记录/)
})

it("manual worker failure keeps its concrete phase before generic count uncertainty", () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-stage-result-"))
  try {
    const result = completion(root, { state: "error", startedAt: 10, failureStage: "publisher_prepare", errorDetail: "发布网络不可用；保留待发布结果，下轮重试" })
    assert.equal(result.state, "error")
    assert.match(result.message, /^准备发布通道失败：发布网络不可用/)
    assert.match(result.message, /本轮采集条数未记录/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it("all-source failures name the collection stage and keep a safe source reason", () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-all-source-error-"))
  const dir = join(root, ".data/mac-batch")
  mkdirSync(dir, { recursive: true })
  try {
    writeFileSync(join(dir, "result.json"), JSON.stringify({ states: [{ checkedAt: 20, status: "error", collectionCounts: { discovered: 0, duplicates: 0, failed: 0 }, diagnostic: { message: "栏目 HTTP 503 token=do-not-persist" } }] }))
    const result = completion(root, { state: "complete", startedAt: 10, publication: { publishedArticles: 0, updatedArticles: 0 } })
    assert.equal(result.state, "error")
    assert.match(result.message, /^采集与分析失败：栏目 HTTP 503/)
    assert.doesNotMatch(result.message, /do-not-persist/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it("unexpected worker exceptions report a generic collection-stage failure without raw exception text", async () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-worker-throw-"))
  const events: Record<string, any>[] = []
  try {
    await collectionTick(root, { now: new Date("2026-09-14T01:00Z"), worker: () => {
      throw new Error("SECRET_RAW_EXCEPTION")
    }, request: async (body) => {
      events.push(body)
      return body.action === "collection-poll" ? { job: { id: "test" } } : { claimed: true }
    } })
    const finish = events.at(-1)!
    assert.equal(finish.state, "error")
    assert.match(finish.message, /^采集与分析失败：采集进程异常退出/)
    assert.doesNotMatch(finish.message, /SECRET_RAW_EXCEPTION/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
