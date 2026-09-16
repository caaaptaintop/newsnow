import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { runWorker } from "../tools/ai-bridge/mac-worker.mjs"

it("labels publisher preparation failures without losing the safe root cause", () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-worker-stage-"))
  const run = (_bin: string, args: string[]) => {
    if (args[0] === "branch") return "main\n"
    if (args[0] === "status") return ""
    if (args[0] === "pull") return "Already up to date.\n"
    if (args[0]?.endsWith?.("publisher.mjs") || args[0] === "tools/ai-bridge/publisher.mjs") throw new Error("发布网络不可用；保留待发布结果，下轮重试")
    throw new Error(`unexpected command ${args.join(" ")}`)
  }
  try {
    const result = runWorker(root, run as any, 100)
    expect(result).toMatchObject({ state: "error", failureStage: "publisher_prepare" })
    expect(result.error).toBe("准备发布通道失败：发布网络不可用；保留待发布结果，下轮重试")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it("requests detailed subprocess diagnostics only for publisher preparation", () => {
  const root = mkdtempSync(join(tmpdir(), "newsnow-worker-capture-"))
  const captures: Array<{ first: string, capture: boolean }> = []
  const run = (_bin: string, args: string[], _cwd: string, _timeout: number, capture = false) => {
    captures.push({ first: args[0], capture })
    if (args[0] === "branch") return "main\n"
    if (args[0] === "status") return ""
    if (args[0] === "pull") return "Already up to date.\n"
    if (args[0] === "tools/ai-bridge/publisher.mjs") return "{}\n"
    if (args[0] === "--tsconfig") return "{}\n"
    if (args[0] === "tools/ai-bridge/antigravity-preflight.mjs") throw new Error("generic preflight failure")
    throw new Error(`unexpected command ${args.join(" ")}`)
  }
  try {
    const result = runWorker(root, run as any, 100)
    expect(result.failureStage).toBe("ai_preflight")
    expect(captures.find(call => call.first === "tools/ai-bridge/publisher.mjs")?.capture).toBe(true)
    expect(captures.filter(call => call.first !== "tools/ai-bridge/publisher.mjs").every(call => call.capture === false)).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
