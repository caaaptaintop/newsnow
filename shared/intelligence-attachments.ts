export type IntelligenceAttachmentKind = "PDF" | "WORD" | "EXCEL" | "PPT" | "OFD" | "ZIP" | "OTHER"

const extensionKinds: Record<string, IntelligenceAttachmentKind> = {
  pdf: "PDF",
  doc: "WORD", docx: "WORD", docm: "WORD", wps: "WORD", rtf: "WORD",
  xls: "EXCEL", xlsx: "EXCEL", xlsm: "EXCEL", xlsb: "EXCEL", csv: "EXCEL",
  ppt: "PPT", pptx: "PPT", pptm: "PPT",
  ofd: "OFD",
  zip: "ZIP", rar: "ZIP", "7z": "ZIP",
}

export function intelligenceAttachmentKind(attachment: { title?: string, url?: string }): IntelligenceAttachmentKind {
  const values = [attachment.title, attachment.url]
  for (const value of values) {
    if (!value) continue
    let decoded = value
    try { decoded = decodeURIComponent(value) } catch { /* Keep encoded text. */ }
    const matches = [...decoded.toLowerCase().matchAll(/\.([a-z0-9]{1,6})(?=$|[?#&=;,\s)）\]}>])/g)]
    for (let index = matches.length - 1; index >= 0; index--) {
      const kind = extensionKinds[matches[index][1]]
      if (kind) return kind
    }
  }
  return "OTHER"
}

export function intelligenceAttachmentKinds(attachments: { title?: string, url?: string }[]) {
  return [...new Set(attachments.map(intelligenceAttachmentKind))]
}
