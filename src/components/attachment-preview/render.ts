import { attachmentPreviewPolicy } from "@shared/attachment-preview"

export function escapePreviewText(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!))
}

/** Parse into an inert template, never an active document. Remote links/resources are removed. */
export function sanitizePreviewHtml(html: string) {
  const template = document.createElement("template")
  template.innerHTML = html
  const allowed = new Set("P DIV SPAN SECTION ARTICLE HEADER FOOTER MAIN H1 H2 H3 H4 H5 H6 TABLE THEAD TBODY TFOOT TR TH TD COL COLGROUP CAPTION BR HR IMG A PRE CODE B STRONG I EM U S STRIKE SUB SUP UL OL LI BLOCKQUOTE STYLE MARK".split(" "))
  const drop = new Set("SCRIPT NOSCRIPT IFRAME OBJECT EMBED SVG MATH FORM INPUT BUTTON SELECT TEXTAREA LINK META BASE AUDIO VIDEO SOURCE PICTURE".split(" "))
  for (const element of [...template.content.querySelectorAll("*")]) {
    if (drop.has(element.tagName)) { element.remove(); continue }
    if (!allowed.has(element.tagName)) { element.replaceWith(...element.childNodes); continue }
    for (const attribute of [...element.attributes]) {
      const key = attribute.name.toLowerCase()
      const keep = ["class", "style", "colspan", "rowspan", "width", "height", "title", "alt", "id", "start", "value"].includes(key)
        || (element.tagName === "IMG" && key === "src" && /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/i.test(attribute.value))
        || (element.tagName === "A" && key === "href" && /^#[a-z0-9_-]+$/i.test(attribute.value))
      if (!keep) element.removeAttribute(attribute.name)
    }
  }
  return template.innerHTML
}

export function previewFrameHtml(html: string, search: string, zoom: number) {
  const template = document.createElement("template")
  template.innerHTML = html // Input has already been sanitized by sanitizePreviewHtml.
  const needle = search.trim().slice(0, 100).toLocaleLowerCase()
  if (needle) {
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    while (walker.nextNode()) if (walker.currentNode.parentElement?.tagName !== "STYLE") nodes.push(walker.currentNode as Text)
    for (const node of nodes) {
      const text = node.data, lower = text.toLocaleLowerCase()
      let offset = 0, index = lower.indexOf(needle)
      if (index < 0) continue
      const fragment = document.createDocumentFragment()
      while (index >= 0) {
        fragment.append(text.slice(offset, index))
        const mark = document.createElement("mark"); mark.textContent = text.slice(index, index + needle.length); fragment.append(mark)
        offset = index + needle.length; index = lower.indexOf(needle, offset)
      }
      fragment.append(text.slice(offset)); node.replaceWith(fragment)
    }
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><meta name="referrer" content="no-referrer"><style>html{background:#e9ecf0;color:#17212f}body{box-sizing:border-box;max-width:1000px;margin:20px auto;background:white;padding:28px;font:16px/1.8 system-ui,sans-serif;overflow-wrap:anywhere;zoom:${Math.min(150, Math.max(60, zoom)) / 100}}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #b9c1cb;padding:5px 8px}img{max-width:100%;height:auto}pre{white-space:pre-wrap}mark{background:#ffe58a;color:#171717}a{color:inherit}h2{font-size:1.25em}@media(max-width:650px){body{margin:0;padding:14px}}</style></head><body>${template.innerHTML}</body></html>`
}

export function renderLegacyDoc(buffer: ArrayBuffer, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./doc.worker.ts", import.meta.url), { type: "module" })
    const stop = () => { worker.terminate(); clearTimeout(timer); signal.removeEventListener("abort", abort) }
    const abort = () => { stop(); reject(new DOMException("预览已取消", "AbortError")) }
    const timer = setTimeout(() => { stop(); reject(new Error("DOC 解析超时，已停止；请下载原文件查看")) }, attachmentPreviewPolicy.parseTimeoutMs)
    signal.addEventListener("abort", abort, { once: true })
    if (signal.aborted) { abort(); return }
    worker.onmessage = (event: MessageEvent<{ html?: string, error?: string }>) => {
      stop()
      if (event.data.error || !event.data.html) reject(new Error(event.data.error || "DOC 解析失败"))
      else resolve(event.data.html)
    }
    worker.onerror = () => { stop(); reject(new Error("DOC 解析器未能加载或运行，请重试或下载原文件")) }
    worker.postMessage({ buffer }, [buffer])
  })
}

export async function renderDocx(buffer: ArrayBuffer) {
  const { renderAsync } = await import("docx-preview")
  const container = document.createElement("div")
  // The renderer reads embedded ZIP resources only. AltChunks and embedded fonts are disabled.
  await renderAsync(buffer, container, undefined, { useBase64URL: true, renderAltChunks: false, ignoreFonts: true, renderComments: false, renderChanges: false, ignoreWidth: true, ignoreHeight: true, breakPages: true, className: "docx" })
  if (!container.textContent?.trim()) throw new Error("DOCX 未提取到可阅读内容，请下载原文件查看")
  if (container.innerHTML.length > 30 * 1024 * 1024) throw new Error("DOCX 解析结果过大，请下载原文件查看")
  return container.innerHTML
}
