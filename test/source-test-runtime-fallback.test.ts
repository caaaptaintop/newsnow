import { expect, it } from "vitest"

import { type SourceConfigTestResult, sourceTestNeedsRuntimeFallback } from "../server/source-admin/test-source-config"

function result(categories: Array<{ category?: "cloudflare_dns" | "access_denied" | "not_found" | "rate_limited", status?: number, ok?: boolean, testStatus?: "passed" | "failed" | "untested" }>): SourceConfigTestResult {
  return {
    schemaVersion: 1,
    mode: "explicit",
    ok: false,
    publishable: false,
    message: "synthetic",
    endpoints: categories.map((item, index) => ({
      id: `endpoint-${index}`,
      name: `栏目${index + 1}`,
      url: `https://example.gov.cn/list-${index}/`,
      ok: item.ok ?? false,
      status: item.testStatus ?? "failed",
      count: 0,
      preview: [],
      message: "synthetic",
      ...(item.category && item.status ? { diagnostic: { stage: "fetch" as const, httpStatus: item.status, category: item.category, evidence: "status" as const } } : {}),
    })),
  }
}

it("queues Mac verification for cloud DNS and cloud-only HTTP access denial", () => {
  expect(sourceTestNeedsRuntimeFallback(result([{ category: "cloudflare_dns", status: 530 }]))).toBe(true)
  expect(sourceTestNeedsRuntimeFallback(result([{ category: "access_denied", status: 403 }]))).toBe(true)
  expect(sourceTestNeedsRuntimeFallback(result([{ category: "access_denied", status: 412 }]))).toBe(true)
  expect(sourceTestNeedsRuntimeFallback(result([
    { category: "cloudflare_dns", status: 530 },
    { category: "access_denied", status: 403 },
  ]))).toBe(true)
})

it("does not queue Mac verification for semantic failures or incomplete tests", () => {
  expect(sourceTestNeedsRuntimeFallback(result([{ category: "access_denied", status: 401 }]))).toBe(false)
  expect(sourceTestNeedsRuntimeFallback(result([{ category: "not_found", status: 404 }]))).toBe(false)
  expect(sourceTestNeedsRuntimeFallback(result([{ category: "rate_limited", status: 429 }]))).toBe(false)
  expect(sourceTestNeedsRuntimeFallback(result([{ testStatus: "untested" }]))).toBe(false)
  expect(sourceTestNeedsRuntimeFallback(result([{ category: "access_denied", status: 403, ok: true, testStatus: "passed" }]))).toBe(false)
  expect(sourceTestNeedsRuntimeFallback({ ...result([{ category: "access_denied", status: 403 }]), mode: "discover" })).toBe(false)
})
