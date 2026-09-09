import { useState } from "react"
import type { IntelligenceArticle } from "@shared/intelligence"
import { intelligenceHttpUrl } from "@shared/intelligence"
import { intelligenceAttachmentKind, intelligenceAttachmentKinds } from "@shared/intelligence-attachments"
import type { AttachmentPreviewTarget } from "@shared/attachment-preview"
import "./style.css"

import Reader from "./reader"

export function AttachmentList({ article }: { article: IntelligenceArticle }) {
  const [selected, setSelected] = useState<AttachmentPreviewTarget | null>(null)
  const attachments = (article.attachments ?? []).flatMap(attachment => {
    const url = intelligenceHttpUrl(attachment.url)
    return url ? [{ ...attachment, url, kind: intelligenceAttachmentKind(attachment) }] : []
  })
  if (!attachments.length) return null
  return <>
    <details className="intel-attachments intel-original-attachments">
      <summary><span className="intel-attachment-summary-title">原文附件 <strong>{attachments.length}</strong> 份</span><span className="intel-attachment-kinds">{intelligenceAttachmentKinds(attachments).map(kind => <span className="intel-file-type" key={kind}>{kind}</span>)}</span></summary>
      <div className="intel-attachment-list">{attachments.map((attachment, index) => <div className="intel-preview-row" key={`${attachment.url}:${index}`}>
        <button type="button" className="intel-attachment-link intel-preview-open" title={`预览：${attachment.title}`} onClick={() => setSelected({ ...attachment, articleKey: article.key, topic: article.topic, articleUrl: article.url, sourceName: article.sourceName })}><span className="intel-file-type">{attachment.kind}</span><span>{attachment.title}</span><span className="intel-preview-label">预览</span></button>
        <a className="intel-preview-download" href={attachment.url} target="_blank" rel="noreferrer">原站下载</a>
      </div>)}</div>
      <small>点击文件名先预览；附件仅临时读取，不保存到本站服务器，不纳入 AI 摘要。</small>
    </details>
    {selected && <Reader target={selected} onClose={() => setSelected(null)} />}
  </>
}
