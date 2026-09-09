/** Attachment bytes are transient; these limits cannot be overridden by a request. */
export const attachmentPreviewPolicy = Object.freeze({
  maxBytes: 20 * 1024 * 1024,
  maxExpandedBytes: 80 * 1024 * 1024,
  maxZipEntries: 4096,
  fetchTimeoutMs: 45000,
  parseTimeoutMs: 20000,
  maxRedirects: 3,
  persistFiles: false,
  externalViewers: false,
})

export interface AttachmentPreviewTarget {
  articleKey: string
  topic: string
  articleUrl: string
  sourceName: string
  title: string
  url: string
}
export type AttachmentFormat = "doc" | "docx" | "pdf" | "text" | "image" | "word-html"

/** Reject local/network-credential URLs before the browser makes any request. */
export function publicAttachmentUrl(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error("附件地址无效") }
  const host = url.hostname.toLowerCase()
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || host.endsWith(".") || !/^[a-z0-9.-]+$/.test(host) || /^[\d.]+$/.test(host) || !host.includes(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) throw new Error("不支持预览本地、内网或含凭据的附件地址")
  url.hash = ""
  return url.href
}

export function attachmentExtension(value: string) {
  let decoded = value
  try { decoded = decodeURIComponent(value) } catch { /* Malformed source filenames remain readable. */ }
  return [...decoded.toLowerCase().matchAll(/\.([a-z0-9]{1,6})(?=$|[?#&=;,\s)）\]}>])/g)].pop()?.[1] ?? ""
}

export function attachmentFilename(disposition: string | null, fallback: string) {
  let name = ""
  const encoded = disposition?.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1]
  try { if (encoded) name = decodeURIComponent(encoded.trim()) } catch { /* Use plain filename below. */ }
  if (!name) name = disposition?.match(/filename\s*=\s*(?:"([^"]*)"|([^;]*))/i)?.slice(1).find(Boolean)?.trim() ?? fallback
  return name.replace(/[\x00-\x1F\x7F/\\]/g, "_").slice(0, 240) || "原文附件"
}

/** Preflight the ZIP directory before any decompression, including disguised DOCX files. */
export function assertDocxArchive(buffer: ArrayBuffer) {
  const data = new DataView(buffer)
  let end = -1
  for (let offset = buffer.byteLength - 22; offset >= Math.max(0, buffer.byteLength - 65557); offset--) {
    if (data.getUint32(offset, true) === 0x06054B50 && offset + 22 + data.getUint16(offset + 20, true) === buffer.byteLength) { end = offset; break }
  }
  if (end < 0) throw new Error("文档压缩结构损坏，无法预览")
  const count = data.getUint16(end + 10, true)
  const length = data.getUint32(end + 12, true)
  let position = data.getUint32(end + 16, true)
  if (data.getUint16(end + 4, true) || data.getUint16(end + 6, true) || count !== data.getUint16(end + 8, true) || count > attachmentPreviewPolicy.maxZipEntries || position + length > end) throw new Error("不支持分卷、ZIP64 或超大文档")
  let total = 0, hasDocument = false
  const limit = position + length
  for (let i = 0; i < count; i++) {
    if (position + 46 > limit || data.getUint32(position, true) !== 0x02014B50) throw new Error("文档目录不完整")
    const size = data.getUint32(position + 24, true)
    const flags = data.getUint16(position + 8, true)
    const nameLength = data.getUint16(position + 28, true)
    const next = position + 46 + nameLength + data.getUint16(position + 30, true) + data.getUint16(position + 32, true)
    if (next > limit || flags & 1 || size === 0xFFFFFFFF) throw new Error("加密或特殊压缩文档暂不支持预览")
    total += size
    if (total > attachmentPreviewPolicy.maxExpandedBytes || size > attachmentPreviewPolicy.maxBytes) throw new Error("文档解压后过大，请下载原文件查看")
    const name = new TextDecoder().decode(new Uint8Array(buffer, position + 46, nameLength))
    if (name === "word/document.xml") hasDocument = true
    position = next
  }
  if (!hasDocument) throw new Error("此压缩格式不是 DOCX；当前请下载原文件查看")
}

export function detectAttachment(buffer: ArrayBuffer, filename: string, mime = ""): { format: AttachmentFormat, mime: string } {
  const b = new Uint8Array(buffer)
  if (!b.length) throw new Error("原站返回了空文件")
  const starts = (values: number[]) => values.every((v, i) => b[i] === v)
  if (starts([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])) return { format: "doc", mime: "application/msword" }
  if (starts([0x50, 0x4B, 0x03, 0x04])) { assertDocxArchive(buffer); return { format: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } }
  const prefix = new TextDecoder().decode(b.subarray(0, 4096))
  if (prefix.slice(0, 1024).includes("%PDF-")) return { format: "pdf", mime: "application/pdf" }
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return { format: "image", mime: "image/png" }
  if (starts([255, 216, 255])) return { format: "image", mime: "image/jpeg" }
  if (/^GIF8[79]a/.test(prefix)) return { format: "image", mime: "image/gif" }
  if (/^RIFF[\s\S]{4}WEBP/.test(prefix)) return { format: "image", mime: "image/webp" }
  if (/^BM/.test(prefix)) return { format: "image", mime: "image/bmp" }
  if (/^\s*\{\\rtf/i.test(prefix)) throw new Error("此文件实际为 RTF（即使后缀为 DOC），本版暂不支持，请下载原文件查看")
  if (/urn:schemas-microsoft-com:office:word|name\s*=\s*["']?progid["']?\s+content\s*=\s*["']?Word\.Document/i.test(prefix)) return { format: "word-html", mime: "text/html" }
  if (/^\s*(?:<!doctype\s+html|<html\b|<head\b|<script\b)/i.test(prefix) || mime.toLowerCase().includes("text/html")) throw new Error("原站返回的是网页、登录页或验证页，不是可预览的附件；请从原网页打开")
  if (["txt", "csv"].includes(attachmentExtension(filename)) || /^text\/(?:plain|csv)(?:;|$)/i.test(mime)) return { format: "text", mime: "text/plain" }
  throw new Error("暂不支持此文件的浏览器预览，请下载原文件查看")
}

export function decodeAttachmentText(buffer: ArrayBuffer) {
  const b = new Uint8Array(buffer)
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder("utf-16le").decode(buffer)
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder("utf-16be").decode(buffer)
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer) } catch { return new TextDecoder("gb18030").decode(buffer) }
}
