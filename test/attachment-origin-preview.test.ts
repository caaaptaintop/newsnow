import { describe, expect, it } from "vitest"
import { originalPdfPreviewUrl } from "../shared/attachment-origin-preview"

describe("original PDF preview fallback", () => {
  it("keeps the exact public government PDF URL", () => {
    const url = "https://sjw.nanjing.gov.cn/zmhd/dczj/202609/P020260903657491913704.pdf"
    expect(originalPdfPreviewUrl({ title: "附件1.pdf", url })).toBe(url)
  })

  it("supports opaque official download URLs when the attachment title identifies a PDF", () => {
    const url = "https://files.example.gov.cn/download?id=123"
    expect(originalPdfPreviewUrl({ title: "征求意见稿.pdf", url })).toBe(url)
  })

  it("does not offer unsafe or non-PDF URLs", () => {
    expect(originalPdfPreviewUrl({ title: "附件.pdf", url: "javascript:alert(1)" })).toBe("")
    expect(originalPdfPreviewUrl({ title: "附件.docx", url: "https://files.example.gov.cn/a.docx" })).toBe("")
  })
})
