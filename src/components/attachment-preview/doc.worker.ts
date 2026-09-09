import docToText from "legacy-word-reader"
import { renderWordModel } from "@shared/attachment-doc-model"

// Only the legacy binary parser runs here. The worker has no file/network/storage operations.
self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer }>) => {
  try {
    const document = docToText.sections(event.data.buffer)
    if (!document || !document.body?.trim()) throw new Error("此 DOC 可能已加密、损坏、仅含图形，或为不支持的 Word 6/95 格式，请下载原文件查看")
    const sections = [["body", ""], ["headers", "页眉与页脚"], ["footnotes", "脚注"], ["endnotes", "尾注"], ["textboxes", "文本框"], ["headerTextboxes", "页眉文本框"], ["annotations", "批注文字（仅供参考）"]]
    const html = sections.map(([key, label]) => {
      const model = document.model?.[key]
      const content = model ? renderWordModel(model) : ""
      return typeof content === "string" && content.trim() ? `${label ? `<hr><h2>${label}</h2>` : ""}${content}` : ""
    }).join("\n")
    if (!html || html.length > 30 * 1024 * 1024) throw new Error("DOC 解析结果为空或过大，请下载原文件查看")
    self.postMessage({ html })
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "DOC 解析失败，请下载原文件查看" }) }
}
