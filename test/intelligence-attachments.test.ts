import { describe, expect, it } from "vitest"
import { intelligenceAttachmentKind, intelligenceAttachmentKinds } from "../shared/intelligence-attachments"

describe("intelligence attachment type labels", () => {
  it("groups common government document formats into readable labels", () => {
    expect(intelligenceAttachmentKind({ title: "标准征求意见稿.docx" })).toBe("WORD")
    expect(intelligenceAttachmentKind({ url: "https://example.gov.cn/file.xlsx?download=1" })).toBe("EXCEL")
    expect(intelligenceAttachmentKind({ title: "宣贯材料.pptx" })).toBe("PPT")
    expect(intelligenceAttachmentKind({ url: "https://example.gov.cn/formal.ofd" })).toBe("OFD")
    expect(intelligenceAttachmentKind({ title: "附件包.rar" })).toBe("ZIP")
    expect(intelligenceAttachmentKind({ title: "政策原文.pdf" })).toBe("PDF")
  })

  it("reads encoded filenames and falls back to OTHER for opaque downloads", () => {
    expect(intelligenceAttachmentKind({ url: "https://example.gov.cn/download?filename=%E6%84%8F%E8%A7%81%E8%A1%A8.docx" })).toBe("WORD")
    expect(intelligenceAttachmentKind({ title: "附件下载", url: "https://example.gov.cn/download?id=1" })).toBe("OTHER")
  })

  it("returns unique kinds in first-seen order for the collapsed card summary", () => {
    expect(intelligenceAttachmentKinds([
      { title: "a.doc" }, { title: "b.docx" }, { title: "c.pdf" }, { title: "d.xlsx" }, { title: "e.pdf" },
    ])).toEqual(["WORD", "PDF", "EXCEL"])
  })
})
