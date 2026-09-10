import { createError, defineEventHandler, getQuery } from "h3"
import { buildingDB } from "../../building/store"
import { isPublishedTopic } from "../../../shared/public-site"
import { sourceConfigSnapshot } from "../../source-admin/store"

export default defineEventHandler(async (event) => {
  const topic = String(getQuery(event).topic || "building")
  if (!isPublishedTopic(topic)) throw createError({ statusCode: 404, message: "该主题暂未开放" })
  return sourceConfigSnapshot(buildingDB(event), topic)
})
