import { type IntelligenceTopic, intelligenceTopics } from "@shared/intelligence"
import { intelligenceFeed } from "../../utils/intelligence-service"

export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store")
  const topic = String(getQuery(event).topic ?? "building") as IntelligenceTopic
  if (!Object.hasOwn(intelligenceTopics, topic)) throw createError({ statusCode: 400, message: "请选择有效主题" })
  return await intelligenceFeed(event, topic)
})
