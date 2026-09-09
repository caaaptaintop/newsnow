import { buildingDB, buildingEnv, articleById } from "../../building/store"
import { reserveRelay, settleRelay } from "../../building/relay-budget"
import { BuildingError } from "@shared/building-contract"
import { attachmentPreviewPolicy } from "@shared/attachment-preview"
import { createError, defineEventHandler, getHeader, getRequestURL, getRequestWebStream, sendStream, setHeaders } from "h3"
import { isPublishedTopic } from "@shared/public-site"
import { intelligenceTopics, intelligenceHttpUrl, type IntelligenceTopic } from "@shared/intelligence"
import { intelligenceSources } from "@shared/official-sources"
import { attachmentNoStoreHeaders, AttachmentRelayError, relayAttachment } from "../../utils/attachment-relay"

const sourceHosts = new Set(intelligenceSources.flatMap(source => [source.home, ...(source.columns ?? []).map(column => column.url)]).flatMap(value => {
  try { return [new URL(value).hostname.toLowerCase()] } catch { return [] }
}))

export default defineEventHandler(async (event) => {
  setHeaders(event, attachmentNoStoreHeaders)
  const origin = getHeader(event, "origin")
  if ((origin && origin !== getRequestURL(event).origin) || getHeader(event, "sec-fetch-site") === "cross-site") throw createError({ statusCode: 403, message: "不允许跨站调用附件转发" })
  if (!/^application\/json(?:;|$)/i.test(getHeader(event, "content-type") ?? "")) throw createError({ statusCode: 415, message: "只接受 JSON 附件定位信息" })
  const stream = getRequestWebStream(event)
  if (!stream) throw createError({ statusCode: 400, message: "缺少附件定位信息" })
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let json = "", length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 8192) { await reader.cancel(); throw createError({ statusCode: 413, message: "请求过大" }) }
      json += decoder.decode(value, { stream: true })
    }
    json += decoder.decode()
  } finally { reader.releaseLock() }
  let body: { topic?: unknown, articleKey?: unknown, url?: unknown }
  try { body = JSON.parse(json) } catch { throw createError({ statusCode: 400, message: "附件定位信息无效" }) }
  if (!body || typeof body.topic !== "string" || !Object.prototype.hasOwnProperty.call(intelligenceTopics, body.topic) || typeof body.articleKey !== "string" || body.articleKey.length > 200 || typeof body.url !== "string" || body.url.length > 4096) throw createError({ statusCode: 400, message: "附件定位信息无效" })
  const topic = body.topic as IntelligenceTopic
  if (!isPublishedTopic(topic)) throw createError({ statusCode: 404, message: "该主题暂未开放" })
  const db = buildingDB(event)
  const article = await articleById(db, body.articleKey)
  const attachment = article?.attachments?.find(item => intelligenceHttpUrl(item.url) === body.url)
  if (!article || !attachment) throw createError({ statusCode: 404, message: "附件不在已收录记录中，请刷新信息流后重试" })
  const env = event.context.cloudflare?.env ?? event.context.env ?? {}
  const extra = String(env.ATTACHMENT_ALLOWED_HOSTS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(value => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(value))
  let lease: string | undefined
  let settled = false
  const settle = (bytes: number, failed: boolean) => {
    if (!lease || settled) return
    settled = true
    const work = settleRelay(db, lease, bytes, failed).catch(() => {})
    const context = event.context.cloudflare?.context
    if (context?.waitUntil) context.waitUntil(work)
  }
  try {
    lease = await reserveRelay(db, getHeader(event, "cf-connecting-ip") ?? "local", String(buildingEnv(event).BUILDING_RATE_SALT ?? ""), attachmentPreviewPolicy.maxBytes)
    const response = await relayAttachment({ url: attachment.url, filename: attachment.title, referer: article.url, allowedHosts: new Set([...sourceHosts, ...extra]), signal: (event as any).web?.request?.signal, onComplete: settle })
    setHeaders(event, Object.fromEntries(response.headers.entries()))
    return sendStream(event, response.body!)
  } catch (error) {
    settle(0, true)
    if (error instanceof BuildingError) { if (error.statusCode === 429) setHeaders(event, { "Retry-After": "60" }); throw createError({ statusCode: error.statusCode, message: error.message }) }
    if (error instanceof AttachmentRelayError) throw createError({ statusCode: error.statusCode, message: error.message })
    throw createError({ statusCode: 502, message: "附件预览读取失败，请使用原站下载" })
  }
})
