import assert from "node:assert/strict"
// eslint-disable-next-line test/no-import-node-test -- The worker uses the standalone Node test runner.
import { it } from "node:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runWorker, shouldRun, workerModel } from "./mac-worker.mjs"

it("background worker uses Luna low and only publishes after the complete source registry is processed", () => {
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
    assert(calls.findIndex(c => c[1] === "push") > calls.indexOf(analyses.at(-1)))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
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
