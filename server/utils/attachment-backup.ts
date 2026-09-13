import { AttachmentRelayError } from "./attachment-relay"

const encoder = new TextEncoder()
export async function backupSignature(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body))), byte => byte.toString(16).padStart(2, "0")).join("")
}

export async function backupAttachment(input: { url: string, referer: string, filename: string }, env: Record<string, unknown>, signal?: AbortSignal, fetcher: typeof fetch = fetch) {
  const endpoint = String(env.ATTACHMENT_BACKUP_URL ?? "")
  const secret = String(env.ATTACHMENT_BACKUP_SECRET ?? "")
  let target: URL
  try {
    target = new URL(endpoint)
  } catch {
    throw new AttachmentRelayError(503, "原站暂时无法从云端访问，备用预览未启用，请打开原网页查看或下载")
  }
  if (target.protocol !== "https:" || target.username || target.password || target.port || target.search || target.hash || target.pathname !== "/attachment" || secret.length < 32) throw new AttachmentRelayError(503, "备用预览配置无效，请打开原网页查看或下载")
  const body = JSON.stringify({ ...input, issuedAt: Date.now(), nonce: crypto.randomUUID() })
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener("abort", abort, { once: true })
  if (signal?.aborted) abort()
  const timer = setTimeout(abort, 20000)
  try {
    const response = await fetcher(target.href, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "X-Attachment-Signature": await backupSignature(secret, body) },
      body,
    })
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      throw new AttachmentRelayError(response.status === 429 ? 429 : 503, "备用预览忙碌或暂时离线，请稍后重试或打开原网页查看或下载")
    }
    // Keep the deadline active through consumption, including a stalled body.
    const { readAttachmentResponse } = await import("../../shared/attachment-fetch")
    const bytes = await readAttachmentResponse(response, controller.signal)
    return new Response(bytes, { headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
      "Content-Disposition": response.headers.get("content-disposition") ?? "inline",
    } })
  } catch (error) {
    if (error instanceof AttachmentRelayError) throw error
    throw new AttachmentRelayError(503, "备用预览暂时不可用，请打开原网页查看或下载")
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", abort)
  }
}
