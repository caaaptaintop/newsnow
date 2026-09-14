import { expect, it } from "vitest"
import { collectionCandidates, collectionCutoff, inCollectionWindow, pageEntirelyBeforeWindow } from "../tools/ai-bridge/collection-window"

const now = Date.parse("2026-09-14T00:00:00+08:00")
const cutoff = collectionCutoff(now)
it("expired or unknown older versions do not hide a recent version of the same URL", () => {
  for (const publishedAt of [cutoff - 1, undefined]) {
    const old = { key: "same-url", title: "旧标题", publishedAt }
    const recent = { key: "same-url", title: "新标题", publishedAt: now }
    const pending = [old, recent]
    expect(collectionCandidates(pending, cutoff, now)).toEqual([recent])
    expect(pending).toEqual([old, recent])
  }
})
it("accepts only dated articles within the rolling year, including the cutoff", () => {
  expect(cutoff).toBe(Date.parse("2025-09-14T00:00:00+08:00"))
  for (const publishedAt of [cutoff, now]) expect(inCollectionWindow({ publishedAt }, cutoff, now)).toBe(true)
  for (const publishedAt of [cutoff - 1, now + 1, undefined, Number.NaN, 0]) expect(inCollectionWindow({ publishedAt }, cutoff, now)).toBe(false)
})
it("stops on an entirely old page, but not mixed dates, pinned recent articles or unknown dates", () => {
  expect(pageEntirelyBeforeWindow([{ publishedAt: cutoff - 1 }], cutoff)).toBe(true)
  for (const rows of [[], [{}], [{ publishedAt: cutoff - 1 }, {}], [{ publishedAt: cutoff - 1 }, { publishedAt: now }]]) expect(pageEntirelyBeforeWindow(rows, cutoff)).toBe(false)
})
