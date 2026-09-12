import { describe, expect, it, vi } from "vitest"
import { runPendingSourceTests } from "../tools/ai-bridge/source-test-runner"
import { intelligenceSources } from "../shared/official-sources"
import { intelligenceSourceSeedConfig } from "../shared/source-config"

const seed = intelligenceSources.find(source => source.id === "official-beijing")!
const config = { ...intelligenceSourceSeedConfig(seed), collectionMode: "explicit" as const,
  endpoints: [{ id: "notice", kind: "notice" as const, name: "通知公告", url: `${seed.home}synthetic/`, enabled: true }] }

describe("Mac source test runner", () => {
  it("reads a bounded pending job and submits the exact tested draft result", async () => {
    const request = vi.fn(async (body: any) => {
      if (body.action === "source-tests") return { jobs: [{ topic: "building", sourceId: seed.id, config, hash: "a".repeat(64), activeRevision: 2, requestedAt: Date.now() - 1000 }] }
      expect(body.action).toBe("source-test-result")
      expect(body.sourceId).toBe(seed.id)
      expect(body.hash).toBe("a".repeat(64))
      expect(body.activeRevision).toBe(2)
      expect(body.requestedAt).toBeTypeOf("number")
      expect(body.result.executor).toBe("mac")
      expect(body.result.runtimePending).toBe(false)
      return { publishable: true, testedAt: body.startedAt }
    })
    const tester = vi.fn(async () => ({ schemaVersion: 1 as const, mode: "explicit", ok: true, publishable: true,
      endpoints: [{ id: "notice", name: "通知公告", url: config.endpoints[0].url, ok: true, count: 1,
        preview: [{ title: "合成运行环境测试文章标题", url: `${seed.home}synthetic/article.html` }], message: "ok" }], message: "ok" }))
    const result = await runPendingSourceTests({ request: request as any, tester: tester as any, limit: 1 })
    expect(result.pending).toBe(1)
    expect(result.completed).toHaveLength(1)
    expect(result.completed[0].publishable).toBe(true)
    expect(tester).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledTimes(2)
  })
  it("does not fabricate work when no runtime test is queued", async () => {
    const request = vi.fn(async () => ({ jobs: [] }))
    const tester = vi.fn()
    expect(await runPendingSourceTests({ request: request as any, tester: tester as any, limit: 1 })).toEqual({ pending: 0, completed: [] })
    expect(tester).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledOnce()
  })
})
