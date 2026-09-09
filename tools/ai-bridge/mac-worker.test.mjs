import assert from "node:assert/strict"
// eslint-disable-next-line test/no-import-node-test -- The worker uses the standalone Node test runner.
import { it } from "node:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runWorker, shouldRun, workerModel } from "./mac-worker.mjs"

it("background worker uses Luna low and runs attachment backfill even when the normal batch is empty", () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-worker-test-"))
  const calls = []
  const run = (bin, args) => {
    calls.push([bin, ...args])
    if (args[0] === "branch") return "main"
    if (bin === "codex") return "Logged in using ChatGPT"
    return ""
  }
  try {
    const result = runWorker(root, run)
    assert.equal(result.state, "complete")
    assert.equal(result.model, "gpt-5.6-luna")
    assert.equal(result.reasoning, "low")
    const analyses = calls.filter(c => c.includes("tools/ai-bridge/mac-batch.ts"))
    assert.equal(analyses.length, 1)
    assert(analyses[0].includes("all"))
    assert(analyses[0].includes("12"))
    assert(analyses.every(c => c.includes(workerModel)))
    const backfills = calls.filter(c => c.includes("tools/ai-bridge/backfill-attachments.ts"))
    assert.equal(backfills.length, 1)
    assert(backfills[0].includes("24"))
    assert.equal(calls.some(c => c.includes("tools/ai-bridge/apply-batch.ts")), false)
    assert(calls.indexOf(backfills[0]) > calls.indexOf(analyses.at(-1)))
    assert(calls.findIndex(c => c[1] === "push") > calls.indexOf(backfills[0]))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it("a backfill-only result is applied and published even when mac-batch produced no result", () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-worker-test-"))
  const calls = []
  const run = (bin, args) => {
    calls.push([bin, ...args])
    if (args[0] === "branch") return "main"
    if (bin === "codex") return "Logged in using ChatGPT"
    if (args.includes("tools/ai-bridge/backfill-attachments.ts")) {
      const directory = join(root, ".data/mac-batch")
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, "result.json"), JSON.stringify({ attachmentUpdates: [{ key: "legacy", attachments: [{ title: "附件.pdf", url: "https://example.gov.cn/attachment.pdf" }] }] }))
    }
    return ""
  }
  try {
    const result = runWorker(root, run)
    assert.equal(result.state, "complete")
    const backfillIndex = calls.findIndex(c => c.includes("tools/ai-bridge/backfill-attachments.ts"))
    const applyIndex = calls.findIndex(c => c.includes("tools/ai-bridge/apply-batch.ts"))
    assert(backfillIndex >= 0)
    assert(applyIndex > backfillIndex)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it("manual Mac sync also backfills before deciding there is no result", () => {
  const command = readFileSync(new URL("./mac-sync.command", import.meta.url), "utf8")
  const batch = command.indexOf("tools/ai-bridge/mac-batch.ts")
  const backfill = command.indexOf("tools/ai-bridge/backfill-attachments.ts")
  const resultCheck = command.indexOf("if [[ ! -f .data/mac-batch/result.json ]]")
  const apply = command.indexOf("tools/ai-bridge/apply-batch.ts")
  assert(batch >= 0)
  assert(backfill > batch)
  assert(resultCheck > backfill)
  assert(apply > resultCheck)
})

it("failed collection preserves its error and allows the next scheduled attempt", () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-worker-test-"))
  try {
    const result = runWorker(root, () => {
      throw new Error("offline")
    })
    assert.equal(result.state, "error")
    assert.equal(result.retryAfter, 0)
    assert.equal(shouldRun(result, result.retryAfter), true)
    const stored = JSON.parse(readFileSync(join(root, ".data/mac-batch/worker-status.json"), "utf8"))
    assert.equal(stored.error, "offline")
    writeFileSync(join(root, ".data/mac-batch/worker-status.json"), "{}")
    assert.equal(runWorker(root, () => {
      throw new Error("released lock")
    }).error, "released lock")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
