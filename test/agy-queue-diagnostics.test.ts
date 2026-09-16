import { expect, it } from "vitest"
import { prioritizeCandidates } from "../tools/ai-bridge/candidate-queue"
import { agyFailureReason } from "../tools/ai-bridge/local-antigravity.mjs"

it("prioritizes recent articles across columns without dropping or mutating candidates", () => {
  const items = [{ key: "old-policy", publishedAt: 1 }, { key: "unknown" }, { key: "new-news", publishedAt: 3 }, { key: "same-date", publishedAt: 3 }, { key: "invalid", publishedAt: Number.NaN }]
  const ordered = prioritizeCandidates(items)
  expect(ordered.map(i => i.key)).toEqual(["new-news", "same-date", "old-policy", "unknown", "invalid"])
  expect(items[0].key).toBe("old-policy")
  expect(new Set(ordered)).toEqual(new Set(items))
})
it("reports only an error category without provider content", () => {
  for (const [input, expected] of [["UNAUTHENTICATED", "authentication"], ["reason=authentication", "authentication"], ["AGY account pool unavailable: account-a:authentication", "authentication"], ["AGY account activation failed: account-a", "unspecified"], ["AGY startup timed out before initialization", "timeout"], ["RESOURCE_EXHAUSTED", "quota_or_rate_limit"], ["reason=quota_or_rate_limit", "quota_or_rate_limit"], ["AGY account pool unavailable: account-a:quota_or_rate_limit", "quota_or_rate_limit"], ["DEADLINE_EXCEEDED", "timeout"], ["503", "service_or_network"], ["arbitrary article body", "unspecified"]]) {
    expect(agyFailureReason(input)).toBe(expected)
  }
})
