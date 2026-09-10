import { createHash } from "node:crypto"
import { expect, it, vi } from "vitest"
import { hackernewsFeed } from "../server/utils/hackernews-feed"
import { collectSource } from "../tools/ai-bridge/collect-source"
import { mergeBatch } from "../tools/ai-bridge/merge-batch"
import { classifyBatch } from "../tools/ai-bridge/classify-batch"
import { enrichOfficialArticleMetadata } from "../tools/ai-bridge/enrich-article"
import { buildingRecallScore } from "../shared/building-recall"
import { intelligenceVersion } from "../shared/intelligence"
import { batchArticleKeys } from "../tools/ai-bridge/article-keys"

const url = "https://zjw.sh.gov.cn/test/urban-renewal.html"
const key = `building:${createHash("sha256").update(url).digest("hex")}`
const article = { key, url, title: "关于推进城市更新工作的通知", sourceId: "official-shanghai", topic: "building", analysisVersion: intelligenceVersion, collectedAt: 1000, evidence: "title", category: "urban_renewal", contentType: "通知公告", importance: 70, summary: "通知涉及推进城市更新工作。", attachments: [], relatedCategories: [], tags: [] }
const batch = { articles: [article], decisions: [{ key, title: article.title, keep: true }] }
it("fujian protocol aliases match historical IDs without changing the primary key or document query", () => {
  const http = "http://zjt.fujian.gov.cn/notice.htm?id=1"
  const https = http.replace("http:", "https:")
  const aliases = batchArticleKeys("building", "official-fujian", https)
  expect(aliases).toEqual([https, http].map(url => `building:${createHash("sha256").update(url).digest("hex")}`))
  expect(batchArticleKeys("building", "official-fujian", http)).toEqual([...aliases].reverse())
  expect(batchArticleKeys("building", "official-fujian", `${https}&id=2`).some(key => aliases.includes(key))).toBe(false)
  expect(batchArticleKeys("building", "official-shanghai", https)).toHaveLength(1)
  expect(batchArticleKeys("ai", "official-fujian", https)).toHaveLength(1)
  expect(batchArticleKeys("building", "official-fujian", "https://other.gov.cn/notice.htm")).toHaveLength(1)
})
it("pending Fujian aliases cannot recreate duplicates or replace richer historical metadata", () => {
  const url = "https://zjt.fujian.gov.cn/notice.htm?id=1"
  const [key, oldKey] = batchArticleKeys("building", "official-fujian", url)
  const pending = { ...article, sourceId: "official-fujian", url, key }
  const old = { ...pending, key: oldKey, url: url.replace("https:", "http:"), summary: "保留更完整的历史摘要", model: "migration" }
  const snapshot = { articles: [old], generatedAt: 1 }
  const batch = { articles: [pending], decisions: [{ key, title: pending.title, keep: true }] }
  expect(mergeBatch(snapshot, batch).articles).toEqual([old])
  expect(mergeBatch(mergeBatch(snapshot, batch), batch)).toEqual(mergeBatch(snapshot, batch))
  expect(mergeBatch({ articles: [] }, { articles: [pending, { ...old, model: "test" }], decisions: [...batch.decisions, { key: oldKey, title: old.title, keep: true }] }).articles).toEqual([expect.objectContaining({ key })])
  expect(mergeBatch({ articles: [{ ...old, title: "不同的公告" }] }, batch).articles).toHaveLength(2)
  expect(() => mergeBatch(snapshot, { ...batch, decisions: [] })).toThrow("Batch article failed validation")
})
it("short classification IDs map by ID even when output order changes, rejecting unknown IDs", async () => {
  const items = [{ key: "long-key-one", title: "一", column: "栏目" }, { key: "long-key-two", title: "二", column: "栏目" }]
  const ai = { model: "test", run: async (_model: string, params: any) => {
    expect(JSON.parse(params.messages[1].content).map((i: any) => i.key)).toEqual(["item-1", "item-2"])
    return { items: [{ key: "item-2", keep: false }, { key: "item-1", keep: false }] }
  } }
  const result = await classifyBatch(ai, "ai", items)
  expect([...result.keys()]).toEqual(["long-key-one", "long-key-two"])
  expect(result.get("long-key-two")?.key).toBe("long-key-two")
  await expect(classifyBatch({ model: "test", run: async () => ({ items: [{ key: "item-9", keep: false }] }) }, "ai", items)).rejects.toThrow("Incomplete")
})
it("mac batch preserves existing articles/states/seen and is idempotent", () => {
  const existing = { key: "existing", title: "keep" }
  const snapshot = { articles: [existing], states: [{ id: "keep" }], seen: { keep: [] }, generatedAt: 1 }
  const merged = mergeBatch(snapshot, batch)
  expect(merged.articles[0]).toEqual(existing)
  expect(merged.states).toEqual(snapshot.states)
  expect(merged.seen).toEqual(snapshot.seen)
  expect(mergeBatch(merged, batch)).toEqual(merged)
})
it("mac batch rejects forged keys and unapproved classifications, strips raw content", () => {
  const snapshot = { articles: [] }
  expect(() => mergeBatch(snapshot, { ...batch, articles: [{ ...article, key: "fake" }] })).toThrow()
  expect(() => mergeBatch(snapshot, { ...batch, decisions: [] })).toThrow()
  expect(() => mergeBatch(snapshot, { ...batch, articles: [{ ...article, category: "unknown" }] })).toThrow()
  const merged = mergeBatch(snapshot, { ...batch, articles: [{ ...article, body: "not persisted", html: "not persisted" }] })
  expect(merged.articles[0]).not.toHaveProperty("body")
  expect(merged.articles[0]).not.toHaveProperty("html")
})
it("mac page enrichment retains Word attachment metadata without storing body HTML", async () => {
  const source = { id: "official-test", home: "https://example.gov.cn/" } as any
  vi.stubGlobal("fetch", vi.fn(async () => new Response(`<div class="TRS_Editor">${"住房城乡建设主管部门公开征求智能建造标准意见。".repeat(8)}<a href="/files/opinion.docx">意见反馈表.docx</a></div>`, { headers: { "content-type": "text/html; charset=utf-8" } })))
  try {
    const metadata = await enrichOfficialArticleMetadata(source, { url: "https://example.gov.cn/notice.html" }, { title: "关于征求智能建造标准意见的通知", url: "https://example.gov.cn/notice.html", column: "通知公告", attachments: [] })
    expect(metadata.attachments).toEqual([{ title: "意见反馈表.docx", url: "https://example.gov.cn/files/opinion.docx" }])
    expect(metadata).not.toHaveProperty("text")
    expect(metadata).not.toHaveProperty("html")
  } finally {
    vi.unstubAllGlobals()
  }
})
it("validated attachment backfills update existing articles without reclassification", () => {
  const existing = { ...article, key: "existing", attachments: [] }
  const snapshot = { articles: [existing], states: [], generatedAt: 1 }
  const update = { key: "existing", attachments: [{ title: "意见表.docx", url: "https://zjw.sh.gov.cn/files/opinion.docx" }] }
  const merged = mergeBatch(snapshot, { articles: [], decisions: [], attachmentUpdates: [update] })
  expect(merged.articles[0].attachments).toEqual(update.attachments)
  expect(mergeBatch(merged, { articles: [], decisions: [], attachmentUpdates: [update] })).toEqual(merged)
  expect(() => mergeBatch(snapshot, { articles: [], decisions: [], attachmentUpdates: [{ key: "existing", attachments: [{ title: "bad", url: "javascript:alert(1)" }] }] })).toThrow("Invalid attachment update")
})
it("shared recall excludes routine safety notices while retaining target topics", () => {
  expect(buildingRecallScore({ title: "建筑工地安全检查情况通报" })).toBe(0)
  expect(buildingRecallScore({ title: "智能建造与城市更新试点项目" })).toBeGreaterThan(0)
})

it("publishes newer source failures even when no articles were accepted", () => {
  const snapshot = { generatedAt: 1, articles: [], states: [{ id: "official-shanghai", status: "ok", checkedAt: 10 }], seen: {} }
  const failed = { articles: [], decisions: [], pipeline: "mac", states: [{ id: "official-shanghai", status: "error", checkedAt: 20, error: "HTTP 412" }] }
  const merged = mergeBatch(snapshot, failed)
  expect(merged.states[0]).toEqual(failed.states[0])
  expect(merged.pipeline).toBe("mac")
  expect(mergeBatch(merged, { ...failed, states: snapshot.states }).states).toEqual(failed.states)
  expect(mergeBatch(merged, failed)).toEqual(merged)
})

it("health batches preserve editorial rules and reject mismatched IDs", async () => {
  const items = [{ key: "health-one", title: "骑车造成锁骨骨折", column: "热榜" }, { key: "health-two", title: "球队赢得比赛", column: "热榜" }]
  const result = await classifyBatch({ model: "test", run: async (_model: string, params: any) => {
    expect(params.messages[0].content).toContain("事实桥梁")
    return { items: [{ key: "item-1", score: 80, primaryLine: "public_event", auxiliaryLines: [], triggers: [], angle: "骨折后应该关注哪些恢复问题？", reason: "标题明确提供骨折事实" }] }
  } }, "health", items)
  expect(result.get("health-one")?.keep).toBe(true)
  expect(result.get("health-two")?.keep).toBe(false)
  await expect(classifyBatch({ model: "test", run: async () => ({ items: [{ key: "item-99" }] }) }, "health", items)).rejects.toThrow("Invalid health")
})

it("keeps readable homepage articles while reporting unreadable columns", async () => {
  const source = { id: "official-test", home: "https://example.gov.cn/", columns: [{ name: "政策文件", url: "https://example.gov.cn/policy/" }] } as any
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(url.endsWith("/policy/") ? "<html>栏目由脚本加载</html>" : "<a href=\"/news/1.html\">关于推进城市更新工作的通知</a>", { headers: { "content-type": "text/html" } })))
  try {
    const collected = await collectSource(source)
    expect(collected.items).toHaveLength(1)
    expect(collected.warnings).toContain("政策文件：栏目未解析到文章")
    expect(collected.warnings.some(w => w.includes("仅读取首页"))).toBe(true)
    vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 412 })))
    await expect(collectSource(source)).rejects.toThrow("HTTP 412")
  } finally {
    vi.unstubAllGlobals()
  }
})

it("hN official API recovers a transient failure and excludes deleted stories", async () => {
  let first = true
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (first) {
      first = false
      throw new Error("temporary connection failure")
    }
    return Response.json(url.endsWith("topstories.json") ? [2, 1] : url.endsWith("2.json") ? { id: 2, title: "AI &amp; agents", type: "story", time: 100, score: 9 } : { id: 1, deleted: true })
  }))
  try {
    const items = await hackernewsFeed()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: "2", title: "AI & agents", pubDate: 100000 })
    expect(items[0].url).toBe("https://news.ycombinator.com/item?id=2")
  } finally {
    vi.unstubAllGlobals()
  }
})
