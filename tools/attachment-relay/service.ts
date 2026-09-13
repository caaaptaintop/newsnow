import { Buffer } from "node:buffer"
import { timingSafeEqual } from "node:crypto"
import { attachmentPreviewPolicy } from "../../shared/attachment-preview"
import { backupSignature } from "../../server/utils/attachment-backup"
import { attachmentNoStoreHeaders, relayAttachment } from "../../server/utils/attachment-relay"
import { readAttachmentResponse } from "../../shared/attachment-fetch"

// The initial backup serves only this diagnosed official origin, never arbitrary URLs.
function officialDownload(value: unknown) {
  if (typeof value !== "string") throw new Error("invalid")
  const url = new URL(value)
  if (url.protocol !== "https:" || url.hostname !== "www.mohurd.gov.cn" || url.username || url.password || url.port || url.hash || (url.pathname !== "/api-gateway/jpaas-web-server/front/document/download" && !/^\/cms_files\/filemanager\/\d+\/attach\/\d+\/[\w-]+\.(?:pdf|docx?|txt|csv|png|jpe?g)$/i.test(url.pathname))) throw new Error("invalid")
  return url.href
}
export function createBackupHandler(secret: string, fetcher: typeof fetch = fetch, now = Date.now) {
  if (secret.length < 32) throw new Error("ATTACHMENT_BACKUP_SECRET must contain at least 32 characters")
  const seen = new Map<string, number>()
  let active = 0
  const error = (status: number) => new Response("Attachment unavailable", { status, headers: attachmentNoStoreHeaders })
  return async (request: Request) => {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/attachment") return error(404)
    if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) return error(415)
    const reader = request.body?.getReader()
    if (!reader) return error(400)
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 8192) {
          await reader.cancel()
          return error(413)
        }
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }
    const body = Buffer.concat(chunks).toString("utf8")
    const signature = request.headers.get("x-attachment-signature") ?? ""
    if (!/^[a-f0-9]{64}$/.test(signature)) return error(401)
    const expected = await backupSignature(secret, body)
    if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return error(401)
    let input: { url: string, referer: string, filename: string, nonce: string, issuedAt: number }
    try {
      input = JSON.parse(body)
      officialDownload(input.url)
      const referer = new URL(input.referer)
      if (referer.protocol !== "https:" || referer.hostname !== "www.mohurd.gov.cn" || referer.username || referer.password || referer.port || typeof input.filename !== "string" || input.filename.length > 240 || !/^[a-f0-9-]{36}$/.test(input.nonce) || !Number.isSafeInteger(input.issuedAt) || Math.abs(now() - input.issuedAt) > 30000) return error(403)
    } catch {
      return error(403)
    }
    for (const [nonce, expires] of seen) {
      if (expires <= now()) seen.delete(nonce)
    }
    if (seen.has(input.nonce)) return error(409)
    if (active >= attachmentPreviewPolicy.relayConcurrent || seen.size >= 256) return error(429)
    seen.set(input.nonce, now() + 60001)
    active++
    try {
      const response = await relayAttachment({ ...input, allowedHosts: new Set(["www.mohurd.gov.cn"]), signal: request.signal, timeoutMs: 15000, fetcher: (url, options) => fetcher(officialDownload(String(url)), options) })
      const bytes = await readAttachmentResponse(response, request.signal)
      return new Response(bytes, { headers: response.headers })
    } catch {
      return error(503)
    } finally {
      active--
    }
  }
}
