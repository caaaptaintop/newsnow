import { useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { decodeAttachmentText, detectAttachment, type AttachmentPreviewTarget } from "@shared/attachment-preview"
import { intelligenceHttpUrl } from "@shared/intelligence"
import { loadAttachment } from "@shared/attachment-fetch"
import { escapePreviewText, previewFrameHtml, renderDocx, renderLegacyDoc, sanitizePreviewHtml } from "./render"

type Preview = { html?: string, blobUrl?: string, format: string, filename: string, via: string }

export default function AttachmentReader({ target, onClose }: { target: AttachmentPreviewTarget, onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const closePreview = useRef(onClose)
  closePreview.current = onClose
  const headingId = useId()
  const [stage, setStage] = useState("正在准备预览…")
  const [error, setError] = useState("")
  const [preview, setPreview] = useState<Preview | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [zoom, setZoom] = useState(100)
  useEffect(() => {
    const element = dialog.current!
    const closeForm = element.querySelector<HTMLFormElement>("[data-preview-close-form]")
    const previous = document.documentElement.style.overflow
    const focused = document.activeElement as HTMLElement | null
    const requestUnmount = (event?: Event) => {
      event?.preventDefault()
      closePreview.current()
    }
    const handleNativeClose = () => closePreview.current()
    const handleNativeCancel = (event: Event) => requestUnmount(event)
    const handleCloseSubmit = (event: Event) => requestUnmount(event)
    element.addEventListener("close", handleNativeClose)
    element.addEventListener("cancel", handleNativeCancel)
    closeForm?.addEventListener("submit", handleCloseSubmit)
    element.showModal(); document.documentElement.style.overflow = "hidden"
    return () => {
      closeForm?.removeEventListener("submit", handleCloseSubmit)
      element.removeEventListener("cancel", handleNativeCancel)
      element.removeEventListener("close", handleNativeClose)
      if (element.open) element.close()
      document.documentElement.style.overflow = previous
      focused?.focus()
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    let blobUrl = ""
    setError(""); setPreview(null); setZoom(100)
    void (async () => {
      try {
        const file = await loadAttachment(target, controller.signal, setStage)
        if (controller.signal.aborted) return
        setStage("正在浏览器内解析附件…")
        const detected = detectAttachment(file.buffer, file.filename, file.mime)
        if (detected.format === "pdf" && !navigator.pdfViewerEnabled) throw new Error("浏览器未启用 PDF 内嵌预览；为避免自动下载，请主动点击下载原文件")
        let html = ""
        if (detected.format === "doc") html = await renderLegacyDoc(file.buffer, controller.signal)
        else if (detected.format === "docx") html = await renderDocx(file.buffer)
        else if (detected.format === "text") html = `<pre>${escapePreviewText(decodeAttachmentText(file.buffer))}</pre>`
        else if (detected.format === "word-html") html = decodeAttachmentText(file.buffer)
        else blobUrl = URL.createObjectURL(new Blob([file.buffer], { type: detected.mime }))
        if (controller.signal.aborted) { if (blobUrl) URL.revokeObjectURL(blobUrl); return }
        setPreview({ html: html ? sanitizePreviewHtml(html) : undefined, blobUrl: blobUrl || undefined, format: detected.format, filename: file.filename, via: file.via })
        setStage("")
      } catch (reason) {
        if (!controller.signal.aborted) { setStage(""); setError(reason instanceof Error ? reason.message : "附件预览失败，请使用原站下载") }
      }
    })()
    return () => { controller.abort(); if (blobUrl) URL.revokeObjectURL(blobUrl) }
  }, [target, attempt])
  const frame = useMemo(() => preview?.html ? previewFrameHtml(preview.html, "", zoom) : "", [preview?.html, zoom])
  return createPortal(<dialog ref={dialog} className="intel-preview-dialog" aria-labelledby={headingId}>
    <header className="intel-preview-header"><div><h2 id={headingId}>{preview?.filename ?? target.title}</h2><p>{target.sourceName} · 按需读取，不保存附件</p></div><form method="dialog" data-preview-close-form><button type="submit" aria-label="关闭附件预览"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></form></header>
    <nav className="intel-preview-toolbar" aria-label="附件预览操作">
      {preview?.html && <label>缩放 <select value={zoom} onChange={event => setZoom(Number(event.target.value))}>{[60, 80, 100, 120, 150].map(value => <option key={value} value={value}>{value}%</option>)}</select></label>}
      <span className="intel-preview-toolbar-spacer" />
      {intelligenceHttpUrl(target.articleUrl) && <a href={target.articleUrl} target="_blank" rel="noreferrer">打开原网页</a>}
      <a href={target.url} target="_blank" rel="noreferrer" className="intel-preview-primary">下载原文件</a>
    </nav>
    <div className="intel-preview-content" aria-busy={!!stage}>
      {stage && <div className="intel-preview-message" role="status"><p>{stage}</p><button type="button" onClick={onClose}>取消预览</button></div>}
      {error && <div className="intel-preview-message" role="alert"><h3>无法在线预览</h3><p>{error}</p><p>不会改用服务器转换、上传到第三方查看器或自动下载。</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重试预览</button></div>}
      {preview?.html && <iframe title="附件阅读预览" sandbox="" referrerPolicy="no-referrer" srcDoc={frame} />}
      {preview?.blobUrl && preview.format === "pdf" && <iframe title="PDF 附件预览" referrerPolicy="no-referrer" src={preview.blobUrl} />}
      {preview?.blobUrl && preview.format === "image" && <div className="intel-preview-image"><img src={preview.blobUrl} alt={preview.filename} /></div>}
    </div>
    <footer className="intel-preview-footer">{preview?.via === "relay" ? "读取方式：无存储流式转发 → 浏览器" : preview?.via === "direct" ? "读取方式：原站 → 浏览器" : "仅在点击预览后读取附件"}。{preview && ["doc", "docx", "word-html"].includes(preview.format) ? "阅读级预览；复杂图形、修订和分页可能与原件不同，以原文件为准。" : "关闭后释放本次预览资源。"}</footer>
  </dialog>, document.body)
}
