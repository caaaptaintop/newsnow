import { intelligenceRefresh } from "../../utils/intelligence-service"

export default defineEventHandler(async (event) => {
  if (Number(getHeader(event, "content-length") ?? 0) > 32768) throw createError({ statusCode: 413, message: "请求过大" })
  const body = await readBody<{ sourceId?: unknown, includeArticles?: unknown, knownKeys?: unknown }>(event)
  if (typeof body?.sourceId !== "string" || body.sourceId.length > 100) throw createError({ statusCode: 400, message: "缺少有效信息源编号" })
  const knownKeys = Array.isArray(body.knownKeys)
    ? body.knownKeys.filter((key): key is string => typeof key === "string" && /^(building|ai|finance):[a-f0-9]{64}$/.test(key)).slice(0, 300)
    : []
  setHeader(event, "Cache-Control", "no-store")
  return await intelligenceRefresh(event, body.sourceId, {
    includeArticles: body.includeArticles === true,
    knownKeys,
  })
})
