import { attachmentPreviewPolicy, detectAttachment } from "../../shared/attachment-preview"
import { buildingHash } from "../../shared/building-contract"
import { attachmentNoStoreHeaders } from "./attachment-relay"

export interface AttachmentCache {
  match: (key: Request) => Promise<Response | undefined>
  put: (key: Request, response: Response) => Promise<unknown>
}

export async function attachmentCacheKey(origin: string, articleKey: string, url: string) {
  const hash = await buildingHash(JSON.stringify([articleKey, url]))
  return new Request(new URL(`/__attachment-cache/v1/${hash}`, origin).href)
}

// This key has no public GET route. The caller must authorize the indexed article
// and reserve the request/byte budget before calling either cache operation.
export async function cachedAttachment(cache: AttachmentCache | undefined, key: Request, now = Date.now()) {
  if (!cache) return
  try {
    const response = await cache.match(key)
    if (!response) return
    const expires = Number(response.headers.get("X-Attachment-Expires"))
    const size = Number(response.headers.get("Content-Length"))
    if (response.status !== 200 || !Number.isFinite(expires) || expires <= now || !Number.isSafeInteger(size) || size <= 0 || size > attachmentPreviewPolicy.maxCacheBytes) {
      void response.body?.cancel().catch(() => {})
      return
    }
    return response
  } catch {
    return undefined
  }
}

export async function cacheAttachment(cache: AttachmentCache | undefined, key: Request, bytes: ArrayBuffer, headers: Headers, now = Date.now()) {
  if (!cache || !bytes.byteLength || bytes.byteLength > attachmentPreviewPolicy.maxCacheBytes) return
  try {
    // Reject gateway/login HTML and invalid archives; cache bytes, never rendered HTML.
    const format = detectAttachment(bytes, headers.get("Content-Disposition") ?? "", headers.get("Content-Type") ?? "").format
    if (format === "word-html") return
    const safe = new Headers({
      "Content-Type": headers.get("Content-Type") ?? "application/octet-stream",
      "Content-Disposition": headers.get("Content-Disposition") ?? "inline",
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": `public, max-age=${attachmentPreviewPolicy.cacheTtlSeconds}`,
      "X-Attachment-Expires": String(now + attachmentPreviewPolicy.cacheTtlSeconds * 1000),
    })
    await cache.put(key, new Response(bytes, { headers: safe }))
  } catch { /* Cache failure never blocks a successful original response. */ }
}

export function privateAttachmentResponse(bytes: ArrayBuffer, headers: Headers, via: "cache" | "relay") {
  return new Response(bytes, { headers: {
    ...attachmentNoStoreHeaders,
    "Content-Type": headers.get("Content-Type") ?? "application/octet-stream",
    "Content-Disposition": headers.get("Content-Disposition") ?? "inline",
    "X-Attachment-Via": via,
  } })
}
