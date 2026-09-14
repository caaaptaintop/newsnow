import { createError, defineEventHandler, getHeader, getRequestWebStream, setHeader } from "h3"
import { requireSameOriginWrite, requireSourceAdmin } from "../../../utils/source-admin-auth"
import { requestCollection } from "../../../source-admin/collection-jobs"

export default defineEventHandler(async (event) => {
  setHeader(event, "cache-control", "private, no-store")
  const principal = await requireSourceAdmin(event)
  requireSameOriginWrite(event)
  if (!/^application\/json(?:;|$)/i.test(getHeader(event, "content-type") ?? "")) throw createError({ statusCode: 415, message: "只接受 JSON 请求" })
  if (Number(getHeader(event, "content-length")) > 256) throw createError({ statusCode: 413, message: "采集请求过大" })
  const stream = getRequestWebStream(event)
  if (!stream) throw createError({ statusCode: 400, message: "缺少采集请求" })
  const reader = stream.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let json = ""
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 256) {
        if (event.node.req.pause) event.node.req.pause()
        else await reader.cancel()
        throw createError({ statusCode: 413, message: "采集请求过大" })
      }
      json += decoder.decode(value, { stream: true })
    }
    json += decoder.decode()
  } catch (error) {
    if (error instanceof TypeError) throw createError({ statusCode: 400, message: "采集请求编码错误" })
    throw error
  } finally {
    reader.releaseLock()
  }
  let body
  try {
    body = JSON.parse(json)
  } catch {
    throw createError({ statusCode: 400, message: "采集请求格式错误" })
  }
  if (!body || Array.isArray(body) || body.action !== "collect" || Object.keys(body).length !== 1) throw createError({ statusCode: 400, message: "只允许触发完整建筑采集" })
  return requestCollection(event, principal.email)
})
