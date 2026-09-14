import { expect, it } from "vitest"
import { antigravityEvaluationModel, evaluationResult, validateEvaluationEvent } from "../tools/ai-bridge/antigravity-evaluation.mjs"

const init = { event: "init", init: { model: antigravityEvaluationModel } }
it("accepts successful text output with usage but does not claim tool isolation", () => {
  const result = evaluationResult([init, { event: "step_update", step_update: { step_type: "agent_response" } }, { event: "result", result: { status: "SUCCESS", response: "{\"items\":[]}", usage: { total_tokens: 1 } } }])
  expect(result.choices[0].message.content).toBe("{\"items\":[]}")
  expect(result.evaluation.toolIsolationVerified).toBe(false)
})
it("rejects tools, unknown events, model substitutions and incomplete results", () => {
  for (const event of [{ event: "step_update", step_update: { step_type: "run_command" } }, { event: "step_update", step_update: { step_type: "invoke_subagent" } }, { event: "init", init: { model: "other" } }, { event: "unexpected" }]) expect(() => validateEvaluationEvent(event)).toThrow()
  for (const events of [[init], [init, { event: "result", result: { status: "ERROR", response: "failed" } }], [init, { event: "result", result: { status: "SUCCESS", response: "" } }]]) expect(() => evaluationResult(events)).toThrow()
})

it("pins the requested effort variant and rejects silent model fallback", async () => {
  const { evaluationModel } = await import("../tools/ai-bridge/antigravity-evaluation.mjs")
  expect(evaluationModel()).toBe("gemini-3.8-flash-low")
  expect(antigravityEvaluationModel).toBe("gemini-3.8-flash-low")
  for (const effort of ["low", "medium", "high"]) {
    const model = evaluationModel(effort)
    expect(model).toBe(`gemini-3.8-flash-${effort}`)
    expect(() => validateEvaluationEvent({ event: "init", init: { model } }, model)).not.toThrow()
    expect(() => validateEvaluationEvent({ event: "init", init: { model: "other" } }, model)).toThrow()
  }
  expect(() => evaluationModel("automatic")).toThrow()
})
