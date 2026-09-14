import { expect, it } from "vitest"
import { InputReceipt, inputParts } from "../tools/ai-bridge/antigravity-input.mjs"

it("preserves all long input and Unicode across bounded pieces", () => {
  const payload = JSON.stringify([{ role: "user", content: `${"完整正文🙂".repeat(15000)}FINAL_MARKER` }])
  const parts = inputParts(payload)
  expect(parts.length).toBeGreaterThan(50)
  expect(parts.every(part => Array.from(part).length <= 1000)).toBe(true)
  expect(parts.join("")).toBe(payload)
  expect(parts.at(-1)).toContain("FINAL_MARKER")
  expect(parts.join("")).not.toContain("\uFFFD")
})

it("requires every injection receipt, rejecting missing and out-of-range steps", () => {
  const receipt = new InputReceipt(3)
  const step = (index: number) => ({ step_type: "unknown", state: "DONE", step_index: index })
  expect(receipt.complete).toBe(false)
  expect(receipt.receive(step(1))).toBe(true)
  expect(receipt.receive(step(3))).toBe(true)
  expect(receipt.receive(step(3))).toBe(true)
  expect(receipt.complete).toBe(false)
  expect(receipt.receive(step(4))).toBe(false)
  expect(receipt.receive({ ...step(2), step_type: "tool_call" })).toBe(false)
  expect(receipt.receive({ ...step(2), state: "RUNNING" })).toBe(false)
  expect(receipt.receive(step(2))).toBe(true)
  expect(receipt.complete).toBe(true)
})
