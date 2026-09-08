import { describe, expect, it } from "vitest"
import { emptyIntelligenceFilters, intelligenceDate, intelligenceHttpUrl, intelligenceCanonicalUrl, intelligenceFilter, intelligenceDedupe, intelligenceTopics, type IntelligenceArticle } from "../shared/intelligence"
import { officialIntelligenceSources, intelligenceSources } from "../shared/official-sources"
import { intelligenceAllowedUrl, intelligenceDiscoverColumns, intelligenceParseList, intelligenceParseArticle } from "../server/utils/intelligence-parser"
import { intelligenceNormalizeDecision, intelligenceParseAI } from "../server/utils/intelligence-ai"

const source = officialIntelligenceSources.find(s => s.id === "official-shenzhen")!
const article: IntelligenceArticle = { key: "a", topic: "building", title: "关于公布本年度智能建造试点项目名单的通知", url: `${source.home}xxgk/tzgg/content/post_123456.html`, sourceId: source.id, sourceName: source.name, sourceGroup: "住建官方", sourceLevel: "市级", region: "广东", city: "深圳", column: "通知公告", publishedAt: intelligenceDate("2026-09-03"), collectedAt: 1788451200000, attachments: [], category: "intelligent_construction", relatedCategories: ["good_housing"], tags: ["BIM", "建筑机器人"], contentType: "通知公告", importance: 80, summary: "发布智能建造试点项目名单。", evidence: "body", model: "test", analysisVersion: "test" }
const decision = { key: "a", keep: true, category: "intelligent_construction", relatedCategories: ["good_housing", "invalid", "intelligent_construction"], tags: ["BIM", "BIM"], contentType: "通知公告", importance: 80, summary: "发布项目名单", reason: "智能建造试点" }

describe("source registry", () => {
  it("registers 1 national, 31 provincial and 22 city agencies without duplicates", () => {
    expect(officialIntelligenceSources).toHaveLength(54)
    expect(officialIntelligenceSources.filter(s => s.level === "省级")).toHaveLength(31)
    expect(new Set(intelligenceSources.map(s => s.id)).size).toBe(intelligenceSources.length)
    for (const s of intelligenceSources) expect(intelligenceHttpUrl(s.home)).toBeTruthy()
  })
  it("preserves all eight Jianing editorial lines", () => expect(Object.keys(intelligenceTopics.health.categories)).toHaveLength(8))
})
describe("safe URLs and dates", () => {
  it("rejects script schemes, credentials and third-party redirects", () => {
    expect(intelligenceHttpUrl("javascript:alert(1)")).toBeUndefined()
    expect(intelligenceHttpUrl("https://name:pass@example.org")).toBeUndefined()
    expect(intelligenceAllowedUrl("//evil.example/collect", source)).toBeUndefined()
    expect(intelligenceAllowedUrl("https://zjj.sz.gov.cn.evil.org/a", source)).toBeUndefined()
    expect(intelligenceAllowedUrl("http://127.0.0.1/a", source)).toBeUndefined()
    expect(intelligenceAllowedUrl("/xxgk/", source)).toBe(`${source.home}xxgk/`)
  })
  it("canonicalizes tracking only and keeps document identifiers", () => {
    expect(intelligenceCanonicalUrl("https://example.org/a?id=2&utm_source=x#top")).toBe("https://example.org/a?id=2")
  })
  it("does not invent publication dates or accept impossible dates", () => {
    expect(intelligenceDate("09-03")).toBeUndefined()
    expect(intelligenceDate("2026-02-30")).toBeUndefined()
    expect(intelligenceDate("1900-02-29")).toBeUndefined()
    expect(intelligenceDate("2000年2月29日")).toBeDefined()
    expect(intelligenceDate("发布日期：2026-09-03")).toBe(Date.parse("2026-09-03T00:00:00+08:00"))
  })
})
describe("multidimensional filters", () => {
  const other = { ...article, key: "b", region: "江苏", city: "南京", tags: ["装配式"] }
  it("uses OR within a dimension and AND between dimensions", () => {
    const f = { ...emptyIntelligenceFilters(), regions: ["江苏", "广东"], cities: ["深圳"] }
    expect(intelligenceFilter([article, other], f).map(a => a.key)).toEqual(["a"])
  })
  it("matches related categories and tag alternatives", () => {
    expect(intelligenceFilter([article], { ...emptyIntelligenceFilters(), category: "good_housing", tags: ["BIM", "未知标签"] })).toHaveLength(1)
  })
  it("searches inside the selected region and handles Unicode", () => {
    expect(intelligenceFilter([article, other], { ...emptyIntelligenceFilters(), regions: ["江苏"], q: "试点 名单" }).map(a => a.key)).toEqual(["b"])
  })
  it("excludes undated documents from date windows", () => {
    expect(intelligenceFilter([{ ...article, publishedAt: undefined }], { ...emptyIntelligenceFilters(), days: 7 }, Date.parse("2026-09-08T00:00:00Z"))).toHaveLength(0)
  })
  it("source groups are valid filter alternatives", () => expect(intelligenceFilter([article], { ...emptyIntelligenceFilters(), sources: ["住建官方"] })).toHaveLength(1))
})
describe("deduplication", () => {
  it("collapses identical URLs and prioritizes national originals for same-title same-date copies", () => {
    const original = { ...article, key: "national", sourceName: "住房和城乡建设部", sourceLevel: "国家", url: "https://www.mohurd.gov.cn/a.html" }
    const result = intelligenceDedupe([article, { ...article, key: "duplicate" }, original])
    expect(result).toHaveLength(1)
    expect(result[0].key).toBe("national")
    expect(result[0].otherSources).toHaveLength(1)
  })
  it("does not merge different dated policies merely because their titles match", () => {
    expect(intelligenceDedupe([article, { ...article, key: "new", url: `${source.home}other.html`, publishedAt: intelligenceDate("2026-09-04") }])).toHaveLength(2)
  })
})
describe("official-page parsing", () => {
  it("discovers institution columns without external navigation", () => {
    const found = intelligenceDiscoverColumns('<a href="/policy/">政策文件</a><a href="https://evil.org/">通知公告</a>', source)
    expect(found.some(c => c.url.endsWith("/policy/"))).toBe(true)
    expect(found.some(c => c.url.includes("evil"))).toBe(false)
  })
  it("extracts full title, relative URL and explicit Shenzhen short-year date", () => {
    const html = '<ul><li><a href="/xxgk/tzgg/content/post_123456.html" title="关于公布本年度智能建造试点项目名单的通知">关于公布…</a><span> 26-09-03 </span></li><li><a href="/xxgk/tzgg/index.html">关于更多通知公告</a></li></ul>'
    const items = intelligenceParseList(html, source, { name: "通知公告", url: source.home })
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe(article.title)
    expect(items[0].publishedAt).toBe(article.publishedAt)
  })
  it("extracts body and attachment but never equates navigation with body", () => {
    const candidate = { title: article.title, url: article.url, column: "通知公告", attachments: [] }
    expect(intelligenceParseArticle('<nav>智能建造 好房子 智慧建筑</nav>', candidate, source).text).toBeUndefined()
    const html = `<meta name="PubDate" content="2026-09-03"><div class="TRS_Editor">${"深圳市发布智能建造试点项目通知。".repeat(10)}<a href="/file.pdf">项目名单</a></div>`
    const parsed = intelligenceParseArticle(html, candidate, source)
    expect(parsed.text).toContain("智能建造")
    expect(parsed.attachments[0].url).toBe(`${source.home}file.pdf`)
    expect(parsed.publishedAt).toBe(article.publishedAt)
  })
})
describe("AI output validation", () => {
  it("requires explicit keep/drop and rejects hallucinated keys", () => {
    expect(intelligenceNormalizeDecision({ ...decision, key: "other" }, new Set(["a"]), "building")).toBeUndefined()
    expect(intelligenceNormalizeDecision({ ...decision, keep: "true" }, new Set(["a"]), "building")).toBeUndefined()
    expect(intelligenceNormalizeDecision({ key: "a", keep: false }, new Set(["a"]), "building")?.keep).toBe(false)
  })
  it("rejects foreign taxonomy, invented types and invalid scores", () => {
    for (const patch of [{ category: "models" }, { contentType: "invented" }, { importance: "NaN" }, { summary: "" }]) expect(intelligenceNormalizeDecision({ ...decision, ...patch }, new Set(["a"]), "building")).toBeUndefined()
  })
  it("normalizes tags and related categories without a score threshold gate", () => {
    const result = intelligenceNormalizeDecision({ ...decision, importance: 1 }, new Set(["a"]), "building")!
    expect(result.keep).toBe(true)
    expect(result.tags).toEqual(["BIM"])
    expect(result.relatedCategories).toEqual(["good_housing"])
  })
  it("parses supported AI envelopes and rejects malformed responses", () => {
    expect(intelligenceParseAI({ response: '```json\n{"items":[]}\n```' })).toEqual([])
    expect(() => intelligenceParseAI({ response: "not JSON" })).toThrow()
    expect(() => intelligenceParseAI({ response: '{"other":[]}' })).toThrow()
  })
})

it("parses Zhengzhou jhtml articles without treating the index as an article", () => {
  const source = { id: "official-zhengzhou", home: "https://zzjsj.zhengzhou.gov.cn/" } as any
  const items = intelligenceParseList('<a href="/tzgg/index.jhtml">住房城乡建设通知公告栏目</a><a href="/tzgg/10229072.jhtml">关于推进智能建造试点工作的通知</a>', source, { name: "通知公告", url: source.home })
  expect(items).toHaveLength(1)
  expect(items[0].url).toBe("https://zzjsj.zhengzhou.gov.cn/tzgg/10229072.jhtml")
})

it("keeps Liaoning date-ID article indexes while excluding directory indexes", () => {
  const source = { home: "https://zjt.ln.gov.cn/" } as any
  const items = intelligenceParseList('<a href="/zjt/tfwj/gfxwj/index.shtml">住房城乡建设规范性文件</a><a href="/zjt/tfwj/lzj/2026070710405193851/index.shtml">关于印发辽宁省住房品质提升行动方案的通知</a>', source, { name: "规范性文件", url: source.home })
  expect(items).toHaveLength(1)
  expect(items[0].url).toContain("2026070710405193851")
})
