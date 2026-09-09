import { createError, defineEventHandler, getRequestURL, setHeaders } from "h3"
import { isPublishedTopic, publicSite } from "@shared/public-site"
import { publicIntelligenceFeed } from "../../utils/public-intelligence"

export default defineEventHandler(async (event) => {
  setHeaders(event, { "Cache-Control": "private, no-store", "CDN-Cache-Control": "no-store", "Cloudflare-CDN-Cache-Control": "no-store" })
  const topics = getRequestURL(event).searchParams.getAll("topic")
  if (topics.length > 1) throw createError({ statusCode: 400, message: "只能选择一个主题" })
  const topic = topics[0] ?? publicSite.defaultTopic
  if (!isPublishedTopic(topic)) throw createError({ statusCode: 404, message: "该主题暂未开放" })
  const { version, updatedAt } = await publicIntelligenceFeed(topic)
  return { topic, version, updatedAt }
})
