import { expect, it } from "vitest"
import { mergeBatch } from "../tools/ai-bridge/merge-batch"
import { batchArticleKeys } from "../tools/ai-bridge/article-keys"
import pair from "./fixtures/fujian-protocol-pair.json"

const attachment = { title: "回归测试元数据链接.docx", url: "https://zjt.fujian.gov.cn/files/recovery-test.docx" }
const batch = {
  articles: [pair.pending],
  decisions: [{ key: pair.pending.key, title: pair.pending.title, keep: true }],
  attachmentUpdates: [{ key: pair.pending.key, attachments: [attachment] }],
}

it("recovers a deleted HTTPS attachment target from a validated real pending article", () => {
  const snapshot = { articles: [pair.retained], generatedAt: 1 }
  const merged = mergeBatch(snapshot, batch)
  expect(merged.articles).toEqual([{ ...pair.retained, attachments: [attachment] }])
  expect(mergeBatch(merged, batch)).toEqual(merged)
})

it("supplements retained attachments without replacing any other historical metadata", () => {
  const oldAttachment = { title: "已有附件.pdf", url: "https://zjt.fujian.gov.cn/files/old.pdf" }
  const old = { ...pair.retained, attachments: [oldAttachment] }
  const snapshot = { articles: [old], generatedAt: 1 }
  const merged = mergeBatch(snapshot, batch)
  expect(merged.articles).toEqual([{ ...old, attachments: [oldAttachment, attachment] }])
  expect(mergeBatch(merged, batch)).toEqual(merged)
  expect(mergeBatch(snapshot, { ...batch, attachmentUpdates: [{ key: pair.pending.key, attachments: [] }] }).articles).toEqual([old])
})

it.each(["unknown", "title", "source", "query", "decision", "url", "ambiguous"])("rejects unsafe alias recovery: %s", (reason) => {
  const input = structuredClone(batch)
  if (reason === "unknown") input.articles = []
  if (reason === "title") {
    input.articles[0].title = "关于推进城市更新的不同通知"
    input.decisions[0].title = input.articles[0].title
  }
  if (reason === "source") input.articles[0].sourceId = "official-shanghai"
  if (reason === "query") {
    input.articles[0].url += "?document=another"
    input.articles[0].key = batchArticleKeys("building", "official-fujian", input.articles[0].url)[0]
    input.decisions[0].key = input.articles[0].key
    input.attachmentUpdates[0].key = input.articles[0].key
  }
  if (reason === "decision") input.decisions = []
  if (reason === "url") input.attachmentUpdates[0].attachments[0].url = "javascript:alert(1)"
  if (reason === "ambiguous") input.articles.push(structuredClone(pair.pending))
  const snapshot = { articles: [pair.retained], generatedAt: 1 }
  const before = structuredClone(snapshot)
  expect(() => mergeBatch(snapshot, input)).toThrow()
  expect(snapshot).toEqual(before)
})

it("rejects retained metadata whose URL does not prove the historical ID", () => {
  expect(() => mergeBatch({ articles: [{ ...pair.retained, url: `${pair.retained.url}?other=1` }] }, batch)).toThrow("Invalid attachment update")
})

it("rejects attachment overflow instead of truncating or clearing the queue", () => {
  const attachments = Array.from({ length: 16 }, (_, i) => ({ title: `old-${i}`, url: `https://zjt.fujian.gov.cn/files/${i}.pdf` }))
  expect(() => mergeBatch({ articles: [{ ...pair.retained, attachments }] }, batch)).toThrow("Attachment alias conflict")
})

it.each([false, true])("deduplicates both batch orders with valid decisions, reversed=%s", (reverse) => {
  const http = { ...pair.pending, key: pair.retained.key, url: pair.retained.url }
  const articles = reverse ? [pair.pending, http] : [http, pair.pending]
  const input = { articles, decisions: articles.map(a => ({ key: a.key, title: a.title, keep: true })) }
  const merged = mergeBatch({ articles: [], generatedAt: 1 }, input)
  expect(merged.articles).toHaveLength(1)
  expect(merged.articles[0].key).toBe(articles[0].key)
  expect(mergeBatch(merged, input)).toEqual(merged)
})

it("replays the real legacy article without changing the retained record", () => {
  const snapshot = { articles: [pair.retained], generatedAt: 1 }
  const merged = mergeBatch(snapshot, { ...batch, attachmentUpdates: [] })
  expect(merged.articles).toEqual(snapshot.articles)
  expect(mergeBatch(merged, { ...batch, attachmentUpdates: [] })).toEqual(merged)
})
