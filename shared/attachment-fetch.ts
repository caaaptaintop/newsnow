import { attachmentFilename, attachmentPreviewPolicy, publicAttachmentUrl, type AttachmentPreviewTarget } from "@shared/attachment-preview"

export interface LoadedAttachment { buffer: ArrayBuffer, filename: string, mime: string, via: "direct" | "relay" }

export async function readAttachmentResponse(response: Response, signal: AbortSignal): Promise<ArrayBuffer> {
  if (!response.body) throw new Error("附件没有可读取的内容")
  if (Number(response.headers.get("content-length")) > attachmentPreviewPolicy.maxBytes) {
    await response.body.cancel()
    throw new Error("附件超过 20 MiB 预览上限，请下载原文件")
  }
  const reader = response.body.getReader()
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener("abort", abort, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("预览已取消", "AbortError")
      const { done, value } = await reader.read()
      if (signal.aborted) throw new DOMException("预览已取消", "AbortError")
      if (done) break
      size += value.byteLength
      if (size > attachmentPreviewPolicy.maxBytes) throw new Error("附件超过 20 MiB 预览上限，请下载原文件")
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return bytes.buffer
  } catch (error) { await reader.cancel().catch(() => {}); throw error } finally { signal.removeEventListener("abort", abort); reader.releaseLock() }
}

export async function loadAttachment(target: AttachmentPreviewTarget, signal: AbortSignal, onStage: (stage: string) => void): Promise<LoadedAttachment> {
  const url = publicAttachmentUrl(target.url)
  const directController = new AbortController()
  const abortDirect = () => directController.abort()
  signal.addEventListener("abort", abortDirect, { once: true })
  if (signal.aborted) abortDirect()
  const timer = setTimeout(abortDirect, 12000)
  let response: Response | undefined
  try {
    onStage("正在从原站读取附件…")
    // Response headers such as Content-Disposition never trigger a browser download through fetch.
    response = await fetch(url, { redirect: "error", signal: directController.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" })
    if (!response.ok || response.status === 206) { await response.body?.cancel(); response = undefined }
    if (response) {
      const buffer = await readAttachmentResponse(response, directController.signal)
      return { buffer, filename: attachmentFilename(response.headers.get("content-disposition"), target.title), mime: response.headers.get("content-type") ?? "", via: "direct" }
    }
  } catch (error) {
    if (signal.aborted) throw new DOMException("预览已取消", "AbortError")
    // A size limit is definitive; do not download the same oversized file again through the relay.
    if (error instanceof Error && error.message.includes("预览上限")) throw error
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abortDirect) }
  if (signal.aborted) throw new DOMException("预览已取消", "AbortError")
  onStage("原站无法直接读取，正在通过无存储转发读取…")
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener("abort", abort, { once: true })
  if (signal.aborted) abort()
  const timeout = setTimeout(abort, attachmentPreviewPolicy.fetchTimeoutMs + 5000)
  try {
    response = await fetch("/api/intelligence/attachment", {
      method: "POST", cache: "no-store", credentials: "same-origin", signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: target.topic, articleKey: target.articleKey, url: target.url }),
    })
    if (!response.ok) {
      let message = `附件读取失败（HTTP ${response.status}），请使用原站下载`
      try { const data = await response.json(); if (typeof data.message === "string") message = data.message.slice(0, 240) } catch { /* Preserve the status fallback. */ }
      throw new Error(message)
    }
    const buffer = await readAttachmentResponse(response, controller.signal)
    return { buffer, filename: attachmentFilename(response.headers.get("content-disposition"), target.title), mime: response.headers.get("content-type") ?? "", via: "relay" }
  } catch (error) {
    if (signal.aborted) throw new DOMException("预览已取消", "AbortError")
    if (controller.signal.aborted) throw new Error("原站读取超时，请使用原站下载")
    throw error
  } finally { clearTimeout(timeout); signal.removeEventListener("abort", abort) }
}
