import { originalPdfPreviewUrl } from "@shared/attachment-origin-preview"
import type { IntelligenceArticle } from "@shared/intelligence"
import { intelligenceHttpUrl } from "@shared/intelligence"
import { intelligenceAttachmentKind, intelligenceAttachmentKinds } from "@shared/intelligence-attachments"
import "./style.css"

export function AttachmentList({ article }: { article: Pick<IntelligenceArticle, "key" | "topic" | "url" | "sourceName" | "attachments"> }) {
  const attachments = (article.attachments ?? []).flatMap(attachment => {
    const url = intelligenceHttpUrl(attachment.url)
    return url ? [{ ...attachment, url, kind: intelligenceAttachmentKind(attachment) }] : []
  })
  if (!attachments.length) return null
  return <>
    <details className="intel-attachments intel-original-attachments">
      <summary><span className="intel-attachment-summary-title">原文附件 <strong>{attachments.length}</strong> 份</span><span className="intel-attachment-kinds">{intelligenceAttachmentKinds(attachments).map(kind => <span className="intel-file-type" key={kind}>{kind}</span>)}</span></summary>
      <div className="intel-attachment-list">{attachments.map((attachment, index) => <div className="intel-preview-row" key={`${attachment.url}:${index}`}>
        {originalPdfPreviewUrl(attachment) ? <a className="intel-attachment-link intel-preview-open" href={originalPdfPreviewUrl(attachment)} target="_blank" rel="noreferrer"><span className="intel-file-type">PDF</span><span>{attachment.title}</span><span className="intel-preview-label">官网预览 ↗</span></a> : <span className="intel-attachment-link intel-attachment-name"><span className="intel-file-type">{attachment.kind}</span><span>{attachment.title}</span></span>}
        <a className="intel-preview-download" href={attachment.url} target="_blank" rel="noreferrer">原站下载</a>
      </div>)}</div>
      <small>PDF 在新标签页打开官方文件；其他附件请从原站下载。是否直接显示或下载由原站和浏览器决定。</small>
    </details>
  </>
}
