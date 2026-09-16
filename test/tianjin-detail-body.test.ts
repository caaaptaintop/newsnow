import { afterEach, expect, it, vi } from "vitest"

import { intelligenceParseArticle } from "../server/utils/intelligence-parser"
import { intelligenceSources } from "../shared/official-sources"
import { enrichOfficialArticlesForClassify } from "../tools/ai-bridge/enrich-article"

const source = intelligenceSources.find(item => item.id === "official-tianjin")!
const column = "住建动态"

afterEach(() => vi.restoreAllMocks())

it("extracts Tianjin detail-content text without falling back to page chrome", () => {
  const text = "天津市住房城乡建设委发布住房建设工作动态，正文包含规划建设、项目推进和公共服务等具体信息。".repeat(4)
  const html = `<html><body><nav>${"导航".repeat(200)}</nav><div class="detail-content trs_editor_view TRS_UEDITOR"><p>${text}</p></div></body></html>`
  const parsed = intelligenceParseArticle(html, { title: "天津市住房建设工作动态", url: `${source.home}article.html`, column, attachments: [] }, source)
  expect(parsed.text).toContain("天津市住房城乡建设委发布住房建设工作动态")
  expect(parsed.text).not.toContain("导航导航导航")
  expect(parsed.mediaOnly).toBeUndefined()
})

it("marks a recognized image-only Tianjin detail page as media-only", () => {
  const html = `<html><body><div class="detail-content trs_editor_view TRS_UEDITOR"><p><img src="/images/guide.png" alt=""></p></div></body></html>`
  const parsed = intelligenceParseArticle(html, { title: "一图读懂｜天津市住房发展十五五", url: `${source.home}guide.html`, column, attachments: [] }, source)
  expect(parsed.text).toBeUndefined()
  expect(parsed.mediaOnly).toBe(true)
})

it("does not hide an unknown-template parser miss as media-only", () => {
  const html = `<html><body><main><img src="/images/decorative.png"><p>${"正文".repeat(100)}</p></main></body></html>`
  const parsed = intelligenceParseArticle(html, { title: "天津未知模板页面正文测试", url: `${source.home}unknown.html`, column, attachments: [] }, source)
  expect(parsed.text).toBeUndefined()
  expect(parsed.mediaOnly).toBeUndefined()
})

it("counts image-only pages separately from true insufficient-body failures", async () => {
  const text = "天津市住房城乡建设委发布住房建设工作动态，正文包含规划建设、项目推进和公共服务等具体信息。".repeat(4)
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input)
    if (url.endsWith("text.html")) return new Response(`<div class="detail-content"><p>${text}</p></div>`, { headers: { "content-type": "text/html" } })
    if (url.endsWith("image.html")) return new Response(`<div class="detail-content"><img src="/guide.png"></div>`, { headers: { "content-type": "text/html" } })
    return new Response("<main>unknown template</main>", { headers: { "content-type": "text/html" } })
  })
  const items = ["text", "image", "unknown"].map(name => ({ key: name, url: `${source.home}${name}.html`, title: `天津测试文章${name}`, column }))
  const result = await enrichOfficialArticlesForClassify(source, items)
  expect(result.fetchFailed).toBe(0)
  expect(result.mediaOnly).toBe(1)
  expect(result.insufficient).toBe(1)
  expect(result.enrichments.get("text")?.text?.length).toBeGreaterThanOrEqual(80)
})
