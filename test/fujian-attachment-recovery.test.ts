import { expect, it, vi } from "vitest"
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

// A/B/C are synthetic metadata only; no attachment URL is fetched.
const A = { title: "A.pdf", url: "https://zjt.fujian.gov.cn/files/A.pdf" }
const B = { title: "B.pdf", url: "https://zjt.fujian.gov.cn/files/B.pdf" }
const C = { title: "C.pdf", url: "https://zjt.fujian.gov.cn/files/C.pdf" }
function mixedBatch(reverse = false, alias = [B], direct = [C]) {
  const updates = [{ key: pair.pending.key, attachments: alias }, { key: pair.retained.key, attachments: direct }]
  return { ...structuredClone(batch), attachmentUpdates: reverse ? updates.reverse() : updates }
}

it.each([false, true])("r1 aggregates both targets and is stable for four replays, reversed=%s", (reverse) => {
  for (const initial of [[], [A]]) {
    const snapshot = { articles: [{ ...pair.retained, attachments: initial }], generatedAt: 1 }
    const input = mixedBatch(reverse)
    const before = structuredClone({ snapshot, input })
    const result = mergeBatch(snapshot, input)
    expect(result.articles).toEqual([{ ...pair.retained, attachments: [...initial, B, C] }])
    let replay = result
    for (let i = 0; i < 4; i++) {
      replay = mergeBatch(replay, input)
      expect(replay).toEqual(result)
    }
    expect({ snapshot, input }).toEqual(before)
  }
})

it.each([false, true])("r1 empty or snapshot-equal updates cannot erase supplements, reversed=%s", (reverse) => {
  const snapshot = { articles: [{ ...pair.retained, attachments: [A] }], generatedAt: 1 }
  for (const [alias, direct, expected] of [[[B], [], [A, B]], [[], [C], [A, C]], [[B], [A], [A, B]], [[], [], [A]]]) {
    const result = mergeBatch(snapshot, mixedBatch(reverse, alias, direct))
    expect(result.articles[0].attachments).toEqual(expected)
    expect(mergeBatch(result, mixedBatch(reverse, alias, direct))).toEqual(result)
  }
})

it("r1 canonical duplicates choose stable new metadata and preserve snapshot metadata", () => {
  const bDuplicate = { title: "Z duplicate", url: `${B.url}#fragment` }
  const aDuplicate = { title: "replacement", url: `${A.url}#fragment` }
  const snapshot = { articles: [{ ...pair.retained, attachments: [A] }], generatedAt: 1 }
  const left = mixedBatch(false, [bDuplicate, aDuplicate], [C, B])
  const right = mixedBatch(true, [aDuplicate, bDuplicate], [B, C])
  const clock = vi.spyOn(Date, "now").mockReturnValue(1789012800000)
  try {
    const first = mergeBatch(snapshot, left)
    const second = mergeBatch(snapshot, right)
    expect(first.articles[0].attachments).toEqual([A, B, C])
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(mergeBatch(first, right)).toEqual(first)
  } finally {
    clock.mockRestore()
  }
})

it("r1 rejects the final mixed union above 16, accepts exactly 16", () => {
  const initial = Array.from({ length: 15 }, (_, i) => ({ title: `old-${i}`, url: `https://zjt.fujian.gov.cn/files/old-${i}.pdf` }))
  const snapshot = { articles: [{ ...pair.retained, attachments: initial }] }
  for (const reverse of [false, true]) {
    expect(() => mergeBatch(snapshot, mixedBatch(reverse))).toThrow("too many attachments")
    expect(mergeBatch(snapshot, mixedBatch(reverse, [B], [B])).articles[0].attachments).toHaveLength(16)
  }
})

it("r1 preserves the pure direct single-update replacement contract", () => {
  const snapshot = { articles: [{ ...pair.retained, attachments: [A] }], generatedAt: 1 }
  const direct = (attachments: typeof A[]) => ({ articles: [], decisions: [], attachmentUpdates: [{ key: pair.retained.key, attachments }] })
  expect(mergeBatch(snapshot, direct([C, B, { ...B, url: `${B.url}#fragment` }])).articles[0].attachments).toEqual([C, B])
  expect(mergeBatch(snapshot, direct([])).articles[0].attachments).toEqual([])
  expect(mergeBatch(snapshot, direct([A])).generatedAt).toBe(1)
})

it.each(["direct", "alias"])("r1 explicitly rejects repeated original keys: %s", (kind) => {
  const input = mixedBatch()
  const update = input.attachmentUpdates[kind === "alias" ? 0 : 1]
  input.attachmentUpdates.push({ ...update, attachments: [] })
  expect(() => mergeBatch({ articles: [pair.retained] }, input)).toThrow("duplicate key")
})

it.each(["updates", "array", "size", "title", "credentials", "snapshot", "decision-false", "document"])("r1 preserves validation failures without mutating inputs: %s", (reason) => {
  const input: any = mixedBatch()
  const snapshot = { articles: [structuredClone(pair.retained)] }
  if (reason === "updates") input.attachmentUpdates = {}
  if (reason === "array") input.attachmentUpdates[1].attachments = null
  if (reason === "size") input.attachmentUpdates[1].attachments = Array.from({ length: 17 }, () => B)
  if (reason === "title") input.attachmentUpdates[1].attachments = [{ ...B, title: "x".repeat(241) }]
  if (reason === "credentials") input.attachmentUpdates[1].attachments = [{ ...B, url: "https://user:password@example.invalid/file.pdf" }]
  if (reason === "snapshot") snapshot.articles.push(structuredClone(pair.retained))
  if (reason === "decision-false") input.decisions[0].keep = false
  if (reason === "document") {
    const article = input.articles[0]
    article.url = article.url.replace("7206194.htm", "7206195.htm")
    article.key = batchArticleKeys(article.topic, article.sourceId, article.url)[0]
    input.decisions[0].key = article.key
    input.attachmentUpdates[0].key = article.key
  }
  const before = structuredClone({ input, snapshot })
  expect(() => mergeBatch(snapshot, input)).toThrow()
  expect({ input, snapshot }).toEqual(before)
})
