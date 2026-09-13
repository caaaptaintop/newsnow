import { buildingDB, buildingEnv, articleById } from "../../building/store"
import { reserveRelay, settleRelay } from "../../building/relay-budget"
import { BuildingError } from "@shared/building-contract"
import { attachmentPreviewPolicy } from "@shared/attachment-preview"
import { createError, defineEventHandler, getHeader, getRequestURL, getRequestWebStream, setHeaders } from "h3"
import { isPublishedTopic } from "@shared/public-site"
import { intelligenceTopics, intelligenceHttpUrl, type IntelligenceTopic } from "@shared/intelligence"
import { intelligenceSources } from "@shared/official-sources"
import { backupAttachment } from "../../utils/attachment-backup"
import { readAttachmentResponse } from "../../../shared/attachment-fetch"
import { type AttachmentCache, attachmentCacheKey, cacheAttachment, cachedAttachment, privateAttachmentResponse } from "../../utils/attachment-cache"
import { AttachmentRelayError, attachmentNoStoreHeaders, relayAttachment, validateAttachmentUrl } from "../../utils/attachment-relay"

// Per-isolate protection for bounded 20 MiB buffers; the D1 limit applies globally.
let activeReads = 0

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
  let transferred = 0
  const settle = (bytes: number, failed: boolean) => {
    if (!lease || settled) return
    settled = true
    const work = settleRelay(db, lease, bytes, failed).catch(() => {})
    const context = event.context.cloudflare?.context
    if (context?.waitUntil) context.waitUntil(work)
  }
  if (activeReads >= attachmentPreviewPolicy.relayInstanceConcurrent) {
    setHeaders(event, { "Retry-After": "60" })
    throw createError({ statusCode: 429, message: "预览服务忙碌，请稍后重试或前往官网查看" })
  }
  activeReads++
  try {
    lease = await reserveRelay(db, getHeader(event, "cf-connecting-ip") ?? "local", String(buildingEnv(event).BUILDING_RATE_SALT ?? ""), attachmentPreviewPolicy.maxBytes)
    validateAttachmentUrl(attachment.url, new Set([...sourceHosts, ...extra]))
    let cache: AttachmentCache | undefined
    try {
      cache = await (globalThis as typeof globalThis & { caches?: { open: (name: string) => Promise<AttachmentCache> } }).caches?.open("newsnow-attachments-v1")
    } catch { /* Optional edge cache. */ }
    const key = await attachmentCacheKey(getRequestURL(event).origin, article.key, attachment.url)
    const cached = await cachedAttachment(cache, key)
    if (cached) {
      try {
        const bytes = await readAttachmentResponse(cached, (event as any).web?.request?.signal ?? new AbortController().signal)
        settle(bytes.byteLength, false)
        return privateAttachmentResponse(bytes, cached.headers, "cache")
      } catch { /* A truncated/evicted cache entry may still be fetched from origin. */ }
    }
    let response: Response
    const input = { url: attachment.url, filename: attachment.title, referer: article.url }
    const signal = (event as any).web?.request?.signal
    try {
      response = await relayAttachment({ ...input, allowedHosts: new Set([...sourceHosts, ...extra]), signal, onComplete: (bytes) => {
        transferred = bytes
      } })
    } catch (error) {
      // Do not retry origin access denials, rate limits, redirects or partial files.
      if (!(error instanceof AttachmentRelayError) || error.statusCode !== 502 || error.upstreamStatus !== 530 || new URL(attachment.url).hostname !== "www.mohurd.gov.cn") throw error
      transferred = attachmentPreviewPolicy.maxBytes // Unknown backup consumption keeps a conservative charge on failure.
      response = await backupAttachment(input, env, signal)
    }
    // Finish the bounded read before returning HTTP 200. Mid-stream upstream
    // failures otherwise appear to the browser as opaque gateway/stream errors.
    const bytes = await readAttachmentResponse(response, (event as any).web?.request?.signal ?? new AbortController().signal)
    transferred = bytes.byteLength
    settle(transferred, false)
    const work = cacheAttachment(cache, key, bytes, response.headers)
    const context = event.context.cloudflare?.context
    if (context?.waitUntil) context.waitUntil(work)
    else await work
    return privateAttachmentResponse(bytes, response.headers, "relay")
  } catch (error) {
    settle(transferred, true)
    if (error instanceof BuildingError) { if (error.statusCode === 429) setHeaders(event, { "Retry-After": "60" }); throw createError({ statusCode: error.statusCode, message: error.message }) }
    if (error instanceof AttachmentRelayError) throw createError({ statusCode: error.statusCode === 502 ? 424 : error.statusCode, message: error.message })
    throw createError({ statusCode: 424, message: "暂时无法读取原站附件，请打开原网页查看或下载原文件" })
  } finally {
    activeReads--
  }
})
