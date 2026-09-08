import { intelligenceTopics, type IntelligenceTopic } from "@shared/intelligence"
import { intelligenceFeed } from "../../utils/intelligence-service"
export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store")
  const topic = String(getQuery(event).topic ?? "building") as IntelligenceTopic
  if (!Object.hasOwn(intelligenceTopics, topic) || topic === "health") throw createError({ statusCode: 400, message: "请选择建筑、AI 科技或财经；运动健康使用原有专用选题接口" })
  return await intelligenceFeed(event, topic)
})
