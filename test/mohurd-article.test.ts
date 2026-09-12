import { expect, it } from "vitest"
import { intelligenceParseArticle } from "../server/utils/intelligence-parser"
import { officialIntelligenceSources } from "../shared/official-sources"
import { intelligenceDate } from "../shared/intelligence"

it("reads MOHURD article body and sibling attachments without surrounding page content", () => {
  const source = officialIntelligenceSources.find(item => item.id === "official-mohurd")!
  const body = "这是合成的标准征求意见正文，用于验证正文容器识别及附件边界。".repeat(4)
  const html = `<meta name="PubDate" content="2026-09-09 11:38"><meta name="MakeTime" content="2026-09-12 13:46:40">
    <div class="editorContent-box"><div class="editorContent-top">页面操作区域</div>
    <div class="editor-content"><p>${body}</p></div>
    <div class="editorContent-download"><a href="/api-gateway/jpaas-web-server/front/document/download?fileName=test.docx">征求意见稿</a></div></div>
    <aside><a href="/unrelated.pdf">无关下载</a></aside>`
  const parsed = intelligenceParseArticle(html, { title: "关于合成标准公开征求意见的通知", url: `${source.home}gongkai/zc/wjk/art/2026/test.html`, column: "标准征求意见", attachments: [] }, source)
  expect(parsed.text).toBe(body)
  expect(parsed.publishedAt).toBe(intelligenceDate("2026-09-09"))
  expect(parsed.attachments).toEqual([{ title: "征求意见稿", url: `${source.home}api-gateway/jpaas-web-server/front/document/download?fileName=test.docx` }])
})
