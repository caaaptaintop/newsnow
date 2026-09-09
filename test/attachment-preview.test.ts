import { afterEach, describe, expect, it, vi } from "vitest"
import { asArrayBuffer, makeFixtures, readDoc, storedZip } from "../scripts/attachment-preview-fixtures.mjs"
import { attachmentFilename, attachmentPreviewPolicy, decodeAttachmentText, detectAttachment, publicAttachmentUrl } from "../shared/attachment-preview"
import { attachmentNoStoreHeaders, relayAttachment, validateAttachmentUrl } from "../server/utils/attachment-relay"
import { readAttachmentResponse } from "../shared/attachment-fetch"
import { renderWordModel } from "../shared/attachment-doc-model"

const fixtures = makeFixtures()
const hosts = new Set(["files.example.com"])
const options = { url: "https://files.example.com/file.doc", filename: "附件.doc", referer: "https://files.example.com/article", allowedHosts: hosts }
afterEach(() => vi.restoreAllMocks())

describe("attachment format verification", () => {
  it.each(["doc", "docx", "pdf", "text", "image"] as const)("detects real %s bytes, not merely a suffix", (key) => {
    const fixture = fixtures[key]
    expect(detectAttachment(asArrayBuffer(fixture.bytes), fixture.filename, fixture.mime).format).toBe(key)
  })
  it("reads a genuine binary DOC with Chinese paragraphs, styling and table cells", () => {
    const doc = readDoc.sections(fixtures.doc.bytes)
    expect(doc.body).toContain("智能建造附件预览")
    const html = renderWordModel(doc.model.body)
    expect(html).toContain("<table>")
    expect(html).toContain("项目名称")
    expect(html).toContain("测试工程")
    expect(html).toContain("font-weight:bold")
    expect(html).toContain("<p ")
    expect(readDoc(new Uint8Array([1, 2, 3]))).toBeNull()
  })
  it("escapes DOC text rather than executing embedded markup", () => {
    const html = renderWordModel([{ kind: "p", runs: [{ text: '<script>alert("x")</script>' }] }])
    expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;")
  })
  it("rejects login HTML and RTF disguised as DOC, but recognizes Word HTML", () => {
    expect(() => detectAttachment(asArrayBuffer(fixtures.bad.bytes), "form.doc", "text/html")).toThrow("登录页")
    expect(() => detectAttachment(asArrayBuffer(fixtures.rtf.bytes), "form.doc")).toThrow("RTF")
    expect(detectAttachment(asArrayBuffer(fixtures.html.bytes), "form.doc").format).toBe("word-html")
    expect(() => detectAttachment(new ArrayBuffer(0), "form.doc")).toThrow("空文件")
  })
  it("rejects non-Word ZIP and oversized/encrypted/truncated ZIP directory entries", () => {
    expect(() => detectAttachment(asArrayBuffer(storedZip({ "test.xml": "x" })), "form.docx")).toThrow("不是 DOCX")
    const huge = Buffer.from(fixtures.docx.bytes)
    const central = huge.indexOf(Buffer.from([0x50, 0x4B, 0x01, 0x02]))
    huge.writeUInt32LE(attachmentPreviewPolicy.maxBytes + 1, central + 24)
    expect(() => detectAttachment(asArrayBuffer(huge), "form.docx")).toThrow("过大")
    const encrypted = Buffer.from(fixtures.docx.bytes); encrypted.writeUInt16LE(1, central + 8)
    expect(() => detectAttachment(asArrayBuffer(encrypted), "form.docx")).toThrow("加密")
    expect(() => detectAttachment(asArrayBuffer(fixtures.docx.bytes.subarray(0, 80)), "form.docx")).toThrow("损坏")
  })
  it("handles UTF-8 disposition filenames and UTF-16/GBK text", () => {
    expect(attachmentFilename("attachment; filename*=UTF-8''%E9%99%84%E4%BB%B6.doc", "unknown")).toBe("附件.doc")
    expect(attachmentFilename('attachment; filename="a/b.doc"', "unknown")).toBe("a_b.doc")
    expect(attachmentFilename("attachment; filename*=UTF-8''%ZZ; filename=test.doc", "unknown")).toBe("test.doc")
    expect(decodeAttachmentText(asArrayBuffer(Buffer.from([255, 254, 45, 78])))).toBe("中")
    expect(decodeAttachmentText(asArrayBuffer(Buffer.from([214, 208, 206, 196])))).toBe("中文")
  })
})

describe("no-storage relay", () => {
  it.each(["http://localhost/a.doc", "http://127.0.0.1/a", "http://2130706433/a", "http://[::1]/a", "https://user:pass@files.example.com/a", "file:///etc/passwd", "https://files.example.com:8443/a", "https://files.example.com./a", "http://a.internal/a"])("rejects unsafe URL %s before fetching", (url) => {
    expect(() => validateAttachmentUrl(url, hosts)).toThrow()
    expect(() => publicAttachmentUrl(url)).toThrow()
  })
  it("allows official government and exact operator hosts, not domain suffix spoofing", () => {
    expect(validateAttachmentUrl("https://zjt.jiangsu.gov.cn/a.doc", hosts).hostname).toBe("zjt.jiangsu.gov.cn")
    expect(() => validateAttachmentUrl("https://files.example.com.evil.com/a.doc", hosts)).toThrow()
    expect(() => validateAttachmentUrl("https://other.com/a.doc", hosts)).toThrow()
  })
  it("streams original bytes and does not propagate credentials, cookies or cache metadata", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "application/msword", "Set-Cookie": "secret", "ETag": "tag", "Cache-Control": "public, max-age=9999" } }))
    const response = await relayAttachment({ ...options, fetcher })
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3])
    for (const [key, value] of Object.entries(attachmentNoStoreHeaders)) expect(response.headers.get(key)).toBe(value)
    expect(response.headers.has("set-cookie")).toBe(false); expect(response.headers.has("etag")).toBe(false)
    const request = fetcher.mock.calls[0][1]
    expect(request.cache).toBe("no-store"); expect(request.credentials).toBe("omit"); expect(request.redirect).toBe("manual")
    expect(request.headers.Cookie).toBeUndefined(); expect(request.headers.Authorization).toBeUndefined()
  })
  it("rechecks every redirect and rejects HTTPS downgrade", async () => {
    for (const location of ["http://127.0.0.1/a", "https://evil.com/a", "http://files.example.com/a"]) {
      const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: location } }))
      await expect(relayAttachment({ ...options, fetcher })).rejects.toMatchObject({ statusCode: 403 })
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
    const loop = vi.fn().mockImplementation(async () => new Response(null, { status: 302, headers: { Location: "/again" } }))
    await expect(relayAttachment({ ...options, fetcher: loop })).rejects.toThrow("重定向")
    expect(loop).toHaveBeenCalledTimes(4)
  })
  it("allows an approved redirect and preserves the original document", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://zjt.jiangsu.gov.cn/document" } })).mockResolvedValueOnce(new Response("DOC"))
    const response = await relayAttachment({ ...options, fetcher })
    expect(await response.text()).toBe("DOC")
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it("rejects upstream failure/partial responses and announced oversized files", async () => {
    for (const status of [403, 404, 500, 206]) await expect(relayAttachment({ ...options, fetcher: vi.fn().mockResolvedValue(new Response("bad", { status })) })).rejects.toMatchObject({ statusCode: 502 })
    await expect(relayAttachment({ ...options, maxBytes: 2, fetcher: vi.fn().mockResolvedValue(new Response("big", { headers: { "Content-Length": "3" } })) })).rejects.toMatchObject({ statusCode: 413 })
  })
  it("enforces size on chunked bodies without buffering the whole file", async () => {
    const cancel = vi.fn()
    const upstream = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])) }, cancel }))
    const response = await relayAttachment({ ...options, maxBytes: 2, fetcher: vi.fn().mockResolvedValue(upstream) })
    await expect(response.arrayBuffer()).rejects.toThrow("预览上限")
    expect(cancel).toHaveBeenCalled()
  })
  it("cancels upstream when the browser cancels preview", async () => {
    const cancel = vi.fn()
    const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel })))
    const response = await relayAttachment({ ...options, fetcher })
    await response.body!.cancel()
    expect(cancel).toHaveBeenCalled(); expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true)
  })
  it("aborts a stalled upstream fetch on timeout", async () => {
    const fetcher = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))))
    await expect(relayAttachment({ ...options, timeoutMs: 10, fetcher })).rejects.toThrow("超时")
  })
})

describe("browser bounded reader", () => {
  it("reads chunks in memory", async () => {
    const buffer = await readAttachmentResponse(new Response("中文"), new AbortController().signal)
    expect(new TextDecoder().decode(buffer)).toBe("中文")
  })
  it("cancels a pending read immediately", async () => {
    const controller = new AbortController(), cancel = vi.fn()
    const pending = readAttachmentResponse(new Response(new ReadableStream({ cancel })), controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(cancel).toHaveBeenCalled()
  })
  it("rejects announced oversize before reading", async () => {
    await expect(readAttachmentResponse(new Response("x", { headers: { "Content-Length": String(attachmentPreviewPolicy.maxBytes + 1) } }), new AbortController().signal)).rejects.toThrow("预览上限")
  })
})
