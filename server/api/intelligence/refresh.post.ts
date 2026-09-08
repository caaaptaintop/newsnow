import { intelligenceRefresh } from "../../utils/intelligence-service"
export default defineEventHandler(async (event) => {
  if (Number(getHeader(event, "content-length") ?? 0) > 2048) throw createError({ statusCode: 413, message: "请求过大" })
  const body = await readBody<{ sourceId?: unknown }>(event)
  if (typeof body?.sourceId !== "string" || body.sourceId.length > 100) throw createError({ statusCode: 400, message: "缺少有效信息源编号" })
  setHeader(event, "Cache-Control", "no-store")
  return await intelligenceRefresh(event, body.sourceId)
})
