import { describe, expect, it, vi } from "vitest"
import { publicIntelligenceFeed } from "../server/utils/public-intelligence"
import { getIntelligenceStore } from "../server/utils/intelligence-store"
vi.mock("../server/utils/intelligence-store", () => ({ getIntelligenceStore: vi.fn(async () => ({ articles: async () => [] })) }))
vi.mock("../shared/intelligence-snapshot", () => {
  const base = { key: "one", topic: "building", title: "建筑测试通知", url: "https://example.gov.cn/one", sourceId: "official-shanghai", sourceName: "上海", sourceGroup: "住建官方", sourceLevel: "省级", region: "上海", city: "上海", column: "通知公告", collectedAt: 1, publishedAt: 1234, category: "policy", relatedCategories: [], tags: [], contentType: "通知公告", importance: 70, summary: "摘要", evidence: "title", model: "secret-runtime-model", analysisVersion: "secret-analysis-version", attachments: [], body: "raw-body", html: "raw-html" }
  return { intelligenceSnapshot: { pipeline: "mac", generatedAt: 10, articles: [base, { ...base, key: "hidden", topic: "health", title: "not public", url: "https://example.gov.cn/hidden" }], states: [{ id: "official-shanghai", status: "error", error: "private runtime error" }], seen: {} } }
})
describe("public DTO and bounded read reuse", () => {
  it("does not expose provider configuration, source errors, or disabled content", async () => {
    const data = await publicIntelligenceFeed("building")
    expect(data.articles).toHaveLength(1)
    expect(data.sources).toHaveLength(54)
    expect(data.articles[0].publishedAt).toBeUndefined()
    expect(data.version).toMatch(/^[a-f0-9]{64}$/)
    for (const field of ["pipeline", "states", "aiEnabled", "model", "persistent"]) expect(data).not.toHaveProperty(field)
    for (const text of ["secret-runtime", "secret-analysis", "private runtime", "not public", "raw-body", "raw-html"]) expect(JSON.stringify(data)).not.toContain(text)
  })
  it("reuses concurrent reads without repeated store initialization", async () => {
    const before = vi.mocked(getIntelligenceStore).mock.calls.length
    const [a, b] = await Promise.all([publicIntelligenceFeed("building"), publicIntelligenceFeed("building")])
    expect(a).toBe(b)
    expect(vi.mocked(getIntelligenceStore).mock.calls.length).toBe(before)
  })
  it.each(["health", "ai", "finance"] as const)("rejects %s even without the middleware", async topic => {
    const before = vi.mocked(getIntelligenceStore).mock.calls.length
    await expect(publicIntelligenceFeed(topic)).rejects.toMatchObject({ statusCode: 404 })
    expect(vi.mocked(getIntelligenceStore).mock.calls.length).toBe(before)
  })
})
