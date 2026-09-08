import { requireAIAdmin, settingsBody, savedProfileAI } from "../../../utils/ai-settings"
export default defineEventHandler(async (event) => {
  await requireAIAdmin(event)
  const body = await settingsBody(event)
  if (typeof body.id !== "string") throw createError({ statusCode: 400, message: "缺少配置编号" })
  const started = Date.now()
  try {
    const ai = await savedProfileAI(event, body.id)
    if (!ai.enabled || !ai.run) throw new Error("AI 配置不可用")
    const result = await ai.run(ai.model, { messages: [{ role: "system", content: '这是接口连通性测试。只输出 JSON {"ok":true}，不要调用工具。' }, { role: "user", content: "执行测试" }], max_completion_tokens: 256, stream: false })
    const raw = result?.choices?.[0]?.message?.content ?? result?.response
    let parsed: any
    try { parsed = JSON.parse(String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) } catch { /* Invalid output is not a successful test. */ }
    if (parsed?.ok !== true) throw new Error("接口已响应，但未通过 JSON 输出测试；尚不能视为分类可用")
    return { ok: true, model: ai.model, provider: ai.provider, elapsedMs: Date.now() - started, checkedAt: Date.now() }
  } catch (error: any) { throw createError({ statusCode: 400, message: error.message }) }
})
