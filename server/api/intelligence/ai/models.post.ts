import { requireAIAdmin, settingsBody, savedProfileAI } from "../../../utils/ai-settings"
export default defineEventHandler(async (event) => {
  await requireAIAdmin(event)
  const body = await settingsBody(event)
  if (typeof body.id !== "string") throw createError({ statusCode: 400, message: "缺少配置编号" })
  try {
    const ai = await savedProfileAI(event, body.id)
    if (!ai.models) throw new Error("此接入不提供模型列表，请手工填写模型 ID")
    return { models: await ai.models() }
  } catch (error: any) { throw createError({ statusCode: 400, message: error.message }) }
})
