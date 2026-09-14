import { BuildingError } from "@shared/building-contract"
import { attachmentPreviewPolicy } from "@shared/attachment-preview"
import { createError, defineEventHandler, getHeader, getRequestURL, getRequestWebStream, setHeaders } from "h3"
import { isPublishedTopic } from "@shared/public-site"
import { type IntelligenceTopic, intelligenceHttpUrl, intelligenceTopics } from "@shared/intelligence"
import { intelligenceSources } from "@shared/official-sources"
import { extractApprovedSourceScope, isArticlePubliclyApproved } from "@shared/source-collection-approval"
import { articleById, buildingDB, buildingEnv } from "../../building/store"
import { reserveRelay, settleRelay } from "../../building/relay-budget"
import { attachmentDeadline } from "../../utils/attachment-deadline"
import { attachmentDelivery } from "../../utils/attachment-delivery"
import { backupAttachment } from "../../utils/attachment-backup"
import { readAttachmentResponse } from "../../../shared/attachment-fetch"
import { type AttachmentCache, attachmentCacheKey, cacheAttachment, cachedAttachment, privateAttachmentResponse } from "../../utils/attachment-cache"
import { AttachmentRelayError, attachmentNoStoreHeaders, relayAttachment, validateAttachmentUrl } from "../../utils/attachment-relay"
import { publishedBuildingSourceOverrides } from "../../utils/source-config-store"

// Per-isolate protection for bounded 20 MiB buffers; the D1 limit applies globally.

let activeReads = 0

const sourceHosts = new Set(intelligenceSources.flatMap(source => [source.home, ...(source.columns ?? []).map(column => column.url)]).flatMap((value) => {
  try {
    return [new URL(value).hostname.toLowerCase()]
  } catch {
    return []
  }
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
  let json = ""
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 8192) {
        await reader.cancel()
        throw createError({ statusCode: 413, message: "请求过大" })
      }
      json += decoder.decode(value, { stream: true })
    }
    json += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  let body: { topic?: unknown, articleKey?: unknown, url?: unknown }
  try {
    body = JSON.parse(json)
  } catch {
    throw createError({ statusCode: 400, message: "附件定位信息无效" })
  }
  if (!body || typeof body.topic !== "string" || !Object.prototype.hasOwnProperty.call(intelligenceTopics, body.topic) || typeof body.articleKey !== "string" || body.articleKey.length > 200 || typeof body.url !== "string" || body.url.length > 4096) throw createError({ statusCode: 400, message: "附件定位信息无效" })
  const topic = body.topic as IntelligenceTopic
  if (!isPublishedTopic(topic)) throw createError({ statusCode: 404, message: "该主题暂未开放" })
  const db = buildingDB(event)
  const article = await articleById(db, body.articleKey)
  const attachment = article?.attachments?.find(item => intelligenceHttpUrl(item.url) === body.url)
  if (!article || !attachment) throw createError({ statusCode: 404, message: "附件不在已收录记录中，请刷新信息流后重试" })
  const configs = await publishedBuildingSourceOverrides(event)
  const approvedScope = extractApprovedSourceScope(configs)
  if (!isArticlePubliclyApproved(article, approvedScope)) {
    throw createError({ statusCode: 404, message: "附件不在已收录记录中，请刷新信息流后重试" })
  }

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
  const deadline = attachmentDeadline(75000, (event as any).web?.request?.signal)
  const signal = deadline.signal
  let released = false
  const release = (failed: boolean) => {
    if (released) return
    released = true
    activeReads--
    signal.removeEventListener("abort", abort)
    deadline.dispose()
    settle(transferred, failed)
  }
  function abort() {
    release(true)
  }
  signal.addEventListener("abort", abort, { once: true })
  const discard = (response: Response | undefined) => {
    void response?.body?.cancel().catch(() => {})
  }
  const deliver = (bytes: ArrayBuffer, headers: Headers, via: "cache" | "relay") => {
    deadline.check()
    transferred = bytes.byteLength
    return privateAttachmentResponse(attachmentDelivery(bytes, release, signal, deadline.remaining()), headers, via)
  }
  try {
    await deadline.run(() => {
      const reservation = reserveRelay(db, getHeader(event, "cf-connecting-ip") ?? "local", String(buildingEnv(event).BUILDING_RATE_SALT ?? ""), attachmentPreviewPolicy.maxBytes).then((id) => {
        lease = id
        // The response may already have timed out while D1 was still pending.
        if (released) settle(0, true)
      })
      event.context.cloudflare?.context?.waitUntil?.(reservation.catch(() => {}))
      return reservation
    })
    validateAttachmentUrl(attachment.url, new Set([...sourceHosts, ...extra]))
    let cache: AttachmentCache | undefined
    try {
      cache = await deadline.run(async () => (globalThis as typeof globalThis & { caches?: { open: (name: string) => Promise<AttachmentCache> } }).caches?.open("newsnow-attachments-v1"))
    } catch {
      // Optional cache failures may fall back only while active.
      deadline.check()
    }
    const key = await deadline.run(() => attachmentCacheKey(getRequestURL(event).origin, article.key, attachment.url))
    const cached = await deadline.run(() => cachedAttachment(cache, key), discard)
    if (cached) {
      try {
        transferred = Number(cached.headers.get("Content-Length"))
        const bytes = await deadline.run(() => readAttachmentResponse(cached, signal))
        return deliver(bytes, cached.headers, "cache")
      } catch {
        // A truncated cache entry may fall back only while active.
        deadline.check()
      }
    }
    let response: Response
    const input = { url: attachment.url, filename: attachment.title, referer: article.url }
    try {
      response = await deadline.run(() => {
        // Until completion is known, a deadline must not refund unknown reads.
        transferred = attachmentPreviewPolicy.maxBytes
        return relayAttachment({ ...input, allowedHosts: new Set([...sourceHosts, ...extra]), signal, onComplete: (bytes) => {
          if (!released) transferred = bytes
        } })
      }, discard)
    } catch (error) {
      deadline.check()
      // Do not retry origin access denials, rate limits, redirects or partial files.
      if (!(error instanceof AttachmentRelayError) || error.statusCode !== 502 || error.upstreamStatus !== 530 || new URL(attachment.url).hostname !== "www.mohurd.gov.cn") throw error
      transferred = attachmentPreviewPolicy.maxBytes // Unknown backup consumption keeps a conservative charge on failure.
      response = await deadline.run(() => backupAttachment(input, env, signal), discard)
    }
    // Finish the bounded read before returning HTTP 200. Mid-stream upstream
    // failures otherwise appear to the browser as opaque gateway/stream errors.
    const bytes = await deadline.run(() => readAttachmentResponse(response, signal))
    transferred = bytes.byteLength
    deadline.check()
    const work = cacheAttachment(cache, key, bytes, response.headers)
    const context = event.context.cloudflare?.context
    if (context?.waitUntil) context.waitUntil(work)
    else await deadline.run(() => work)
    return deliver(bytes, response.headers, "relay")
  } catch (error) {
    release(true)
    if (error instanceof BuildingError) {
      if (error.statusCode === 429) setHeaders(event, { "Retry-After": "60" })
      throw createError({ statusCode: error.statusCode, message: error.message })
    }
    if (error instanceof AttachmentRelayError) throw createError({ statusCode: error.statusCode === 502 ? 424 : error.statusCode, message: error.message })
    throw createError({ statusCode: 424, message: "暂时无法读取原站附件，请打开原网页查看或下载原文件" })
  }
})
