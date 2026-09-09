import { attachmentExtension, publicAttachmentUrl, type AttachmentPreviewTarget } from "./attachment-preview"

/**
 * Returns the exact public source URL only when the attachment is explicitly a PDF.
 * The URL is never proxied, rewritten or sent to a third-party viewer.
 */
export function originalPdfPreviewUrl(target: Pick<AttachmentPreviewTarget, "title" | "url">) {
  try {
    const url = publicAttachmentUrl(target.url)
    return attachmentExtension(url) === "pdf" || attachmentExtension(target.title) === "pdf" ? url : ""
  } catch {
    return ""
  }
}
