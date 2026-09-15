import { expect, it } from "vitest"
import { collectionCandidates, collectionCutoff, inCollectionWindow, pageEntirelyBeforeWindow, publicationArticleAllowed } from "../tools/ai-bridge/collection-window"

const now = Date.parse("2026-09-15T00:00:00+08:00")
const cutoff = collectionCutoff(now)

it("过期或未知的较早版本不会隐藏同 URL 的较新版本", () => {
  for (const publishedAt of [cutoff - 1, undefined]) {
    const old = { key: "same-url", title: "旧标题", publishedAt }
    const recent = { key: "same-url", title: "新标题", publishedAt: now }
    const pending = [old, recent]
    expect(collectionCandidates(pending, cutoff, now)).toEqual([recent])
    expect(pending).toEqual([old, recent])
  }
})

it("仅接受自然月窗口内有日期的条目，包含边界并排除未来或无效值", () => {
  expect(cutoff).toBe(Date.parse("2026-06-15T00:00:00+08:00"))
  for (const publishedAt of [cutoff, now]) expect(inCollectionWindow({ publishedAt }, cutoff, now)).toBe(true)
  for (const publishedAt of [cutoff - 1, now + 1, undefined, Number.NaN, 0]) expect(inCollectionWindow({ publishedAt }, cutoff, now)).toBe(false)
})

it("月末回退自然月时正确 clamp 到目标月最后一天", () => {
  const may31 = Date.parse("2026-05-31T00:00:00+08:00")
  expect(collectionCutoff(may31)).toBe(Date.parse("2026-02-28T00:00:00+08:00"))
})

it("整页皆旧时停止，但包含混合日期、置顶最新条目或未知日期时不提前停止", () => {
  expect(pageEntirelyBeforeWindow([{ publishedAt: cutoff - 1 }], cutoff)).toBe(true)
  for (const rows of [[], [{}], [{ publishedAt: cutoff - 1 }, {}], [{ publishedAt: cutoff - 1 }, { publishedAt: now }]]) expect(pageEntirelyBeforeWindow(rows, cutoff)).toBe(false)
})

it("已存在 key 即便旧日期或 undefined 仍允许，新增文章在窗口和边界内允许并拒绝窗口外", () => {
  const existingKeys = new Set(["existing-1", "existing-2"])

  // 新增文章：cutoff 边界和窗口内允许
  expect(publicationArticleAllowed({ key: "new-boundary-cutoff", publishedAt: cutoff }, existingKeys, cutoff, now)).toBe(true)
  expect(publicationArticleAllowed({ key: "new-boundary-now", publishedAt: now }, existingKeys, cutoff, now)).toBe(true)
  expect(publicationArticleAllowed({ key: "new-inside", publishedAt: cutoff + 1000 }, existingKeys, cutoff, now)).toBe(true)

  // 新增文章：cutoff-1、future、undefined 拒绝
  expect(publicationArticleAllowed({ key: "new-old", publishedAt: cutoff - 1 }, existingKeys, cutoff, now)).toBe(false)
  expect(publicationArticleAllowed({ key: "new-future", publishedAt: now + 1 }, existingKeys, cutoff, now)).toBe(false)
  expect(publicationArticleAllowed({ key: "new-undefined", publishedAt: undefined }, existingKeys, cutoff, now)).toBe(false)

  // 已存在 key 即便旧日期或 undefined 仍允许
  expect(publicationArticleAllowed({ key: "existing-1", publishedAt: cutoff - 1 }, existingKeys, cutoff, now)).toBe(true)
  expect(publicationArticleAllowed({ key: "existing-1", publishedAt: undefined }, existingKeys, cutoff, now)).toBe(true)
  expect(publicationArticleAllowed({ key: "existing-2", publishedAt: now + 86400000 }, existingKeys, cutoff, now)).toBe(true)
})
