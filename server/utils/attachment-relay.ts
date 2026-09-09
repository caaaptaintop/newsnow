import { attachmentFilename, attachmentPreviewPolicy } from "../../shared/attachment-preview"

export class AttachmentRelayError extends Error {
  constructor(public statusCode: number, message: string) { super(message); this.name = "AttachmentRelayError" }
}

/** Exact operator-controlled hosts, plus government domains. Never trust a host from the request body. */
export function validateAttachmentUrl(value: string, allowedHosts: ReadonlySet<string>): URL {
  let url: URL
  try { url = new URL(value) } catch { throw new AttachmentRelayError(400, "附件地址无效") }
  const host = url.hostname.toLowerCase()
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || host.endsWith(".") || !/^[a-z0-9.-]+$/.test(host) || /^[\d.]+$/.test(host) || !host.includes(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) throw new AttachmentRelayError(403, "此附件地址不允许通过转发服务读取")
  if (!host.endsWith(".gov.cn") && !allowedHosts.has(host)) throw new AttachmentRelayError(403, "附件所在域名尚未获准转发，请使用原站下载")
  url.hash = ""
  return url
}

export const attachmentNoStoreHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "CDN-Cache-Control": "no-store",
  "Cloudflare-CDN-Cache-Control": "no-store",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
}

/** Only stream chunks. No arrayBuffer/blob, filesystem, database, KV, R2 or Cache API. */
export async function relayAttachment(input: {
  url: string
  filename: string
  referer: string
  allowedHosts: ReadonlySet<string>
  fetcher?: typeof fetch
  signal?: AbortSignal
  timeoutMs?: number
  onComplete?: (bytes: number, failed: boolean) => void
  maxBytes?: number
}): Promise<Response> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  const timeout = setTimeout(abort, input.timeoutMs ?? attachmentPreviewPolicy.fetchTimeoutMs)
  input.signal?.addEventListener("abort", abort, { once: true })
  if (input.signal?.aborted) abort()
  let finished = false
  let total = 0
  const finish = (failed = false) => {
    if (finished) return
    finished = true
    input.onComplete?.(total, failed)
    clearTimeout(timeout)
    input.signal?.removeEventListener("abort", abort)
  }
  try {
    let url = validateAttachmentUrl(input.url, input.allowedHosts)
    let referer = ""
    try { referer = validateAttachmentUrl(input.referer, input.allowedHosts).href } catch { /* No caller-supplied headers are forwarded. */ }
    const fetcher = input.fetcher ?? fetch
    let upstream: Response | undefined
    for (let redirects = 0; redirects <= attachmentPreviewPolicy.maxRedirects; redirects++) {
      // Cloudflare/WHATWG fetch supports cache=no-store; the repository's RequestInit shim does not declare it.
      const requestOptions = {
        method: "GET", redirect: "manual", cache: "no-store", credentials: "omit", signal: controller.signal,
        headers: { "Accept": "*/*", "Accept-Encoding": "identity", "Cache-Control": "no-cache", ...(referer ? { Referer: referer } : {}) },
      } as RequestInit
      upstream = await fetcher(url.href, requestOptions)
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break
      const location = upstream.headers.get("location")
      await upstream.body?.cancel()
      if (!location || redirects === attachmentPreviewPolicy.maxRedirects) throw new AttachmentRelayError(502, "附件重定向次数过多或地址无效")
      const next = validateAttachmentUrl(new URL(location, url).href, input.allowedHosts)
      if (url.protocol === "https:" && next.protocol === "http:") throw new AttachmentRelayError(403, "不允许附件重定向到不安全连接")
      url = next
    }
    if (!upstream?.ok || upstream.status === 206 || !upstream.body) {
      await upstream?.body?.cancel()
      throw new AttachmentRelayError(502, `原站未返回完整附件（HTTP ${upstream?.status ?? 0}），请从原网页打开`)
    }
    const maxBytes = input.maxBytes ?? attachmentPreviewPolicy.maxBytes
    if (Number(upstream.headers.get("content-length")) > maxBytes) {
      await upstream.body.cancel()
      throw new AttachmentRelayError(413, "附件超过 20 MiB 预览上限，请下载原文件")
    }
    const filename = attachmentFilename(upstream.headers.get("content-disposition"), input.filename)
    const headers = new Headers(attachmentNoStoreHeaders)
    headers.set("Content-Type", upstream.headers.get("content-type") ?? "application/octet-stream")
    headers.set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(filename)}`)
    // Never copy Content-Encoding, Content-Length, Set-Cookie, ETag or upstream cache headers.
    const reader = upstream.body.getReader()
    const stream = new ReadableStream<Uint8Array>({
      async pull(output) {
        try {
          const { done, value } = await reader.read()
          if (done) { finish(); output.close(); return }
          if (total + value.byteLength > maxBytes) throw new AttachmentRelayError(413, "附件超过预览上限，请下载原文件")
          total += value.byteLength
          output.enqueue(value)
        } catch (error) {
          finish(true); controller.abort()
          void reader.cancel().catch(() => {})
          output.error(error)
        }
      },
      async cancel() { finish(true); controller.abort(); await reader.cancel().catch(() => {}) },
    })
    return new Response(stream, { status: 200, headers })
  } catch (error) {
    finish(true); controller.abort()
    if (error instanceof AttachmentRelayError) throw error
    throw new AttachmentRelayError(502, "原站附件读取失败或超时，请从原网页打开")
  }
}
