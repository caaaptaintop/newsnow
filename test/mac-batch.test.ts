import { createHash } from "node:crypto"
import { expect, it } from "vitest"
import { mergeBatch } from "../tools/ai-bridge/merge-batch"
import { buildingRecallScore } from "../shared/building-recall"
import { intelligenceVersion } from "../shared/intelligence"

const url = "https://zjw.sh.gov.cn/test/urban-renewal.html"
const key = `building:${createHash("sha256").update(url).digest("hex")}`
const article = { key, url, title: "关于推进城市更新工作的通知", sourceId: "official-shanghai", topic: "building", analysisVersion: intelligenceVersion, collectedAt: 1000, evidence: "title", category: "urban_renewal", contentType: "通知公告", importance: 70, summary: "通知涉及推进城市更新工作。", attachments: [], relatedCategories: [], tags: [] }
const batch = { articles: [article], decisions: [{ key, title: article.title, keep: true }] }
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
it("shared recall excludes routine safety notices while retaining target topics", () => {
  expect(buildingRecallScore({ title: "建筑工地安全检查情况通报" })).toBe(0)
  expect(buildingRecallScore({ title: "智能建造与城市更新试点项目" })).toBeGreaterThan(0)
})
