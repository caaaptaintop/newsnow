import { describe, expect, it } from "vitest"
import { publicApiAllowed, publicSite, isPublishedTopic, isPublishedSource } from "../shared/public-site"
import { intelligenceSources } from "../shared/official-sources"
import { publishedSnapshot } from "../shared/published-snapshot"

describe("building-only policy", () => {
  it("has no user system and only one active topic", () => {
    expect(publicSite.enabledTopics).toEqual(["building"])
    expect(publicSite.loginEnabled).toBe(false)
    expect(publicSite.readOnly).toBe(true)
    expect(Object.isFrozen(publicSite.enabledTopics)).toBe(true)
  })
  it.each(["health", "ai", "finance", "__proto__", "constructor", "BUILDING", "", null, ["building"]])("does not publish %s", value => expect(isPublishedTopic(value)).toBe(false))
  it("collects the 54 configured building sources, preserving disabled definitions", () => {
    const enabled = intelligenceSources.filter(isPublishedSource)
    expect(enabled).toHaveLength(54)
    expect(enabled.every(source => source.topic === "building")).toBe(true)
    expect(intelligenceSources.some(source => source.topic === "health")).toBe(true)
    expect(isPublishedSource({ enabled: false, topic: "building" })).toBe(false)
  })
  it.each(["/api/intelligence/refresh", "/api/topics/health/classify", "/api/intelligence/storage", "/api/intelligence/ai/settings", "/api/login", "/api/oauth/github", "/api/me", "/api/s", "/api/proxy", "/api/unknown"])('closes legacy/admin API %s', path => {
    expect(publicApiAllowed(path, "GET")).toBe(false)
    expect(publicApiAllowed(path, "POST")).toBe(false)
  })
  it("allows only read and exact indexed-preview methods", () => {
    expect(publicApiAllowed("/api/intelligence", "GET")).toBe(true)
    expect(publicApiAllowed("/api/intelligence/version", "HEAD")).toBe(true)
    expect(publicApiAllowed("/api/intelligence", "POST")).toBe(false)
    expect(publicApiAllowed("/api/intelligence/attachment", "POST")).toBe(true)
    expect(publicApiAllowed("/api/intelligence/attachment", "GET")).toBe(false)
    expect(publicApiAllowed("/api/intelligenceevil", "GET")).toBe(false)
  })
  it("projects only active metadata for runtime builds and leaves archival input untouched", () => {
    const base = { key: "building:one", topic: "building", title: "示例", url: "https://example.gov.cn/1", sourceId: "official-shanghai", sourceName: "上海", sourceGroup: "住建官方", sourceLevel: "省级", region: "上海", city: "上海", column: "通知公告", collectedAt: 1, category: "policy", relatedCategories: [], tags: [], contentType: "通知公告", importance: 70, summary: "摘要", evidence: "title", model: "internal", analysisVersion: "internal", attachments: [{ title: "表.doc", url: "https://example.gov.cn/1.doc", bytes: "never save" }], body: "never save", html: "never save" }
    const inactive = intelligenceSources.find(source => source.topic === "health")!
    const input: any = { pipeline: "mac", generatedAt: 1, articles: [base, { ...base, key: "health:two", topic: "health" }], states: [{ id: "official-shanghai", status: "ok" }, { id: inactive.id, status: "ok" }], seen: { "official-shanghai": [], [inactive.id]: [] } }
    const before = JSON.stringify(input)
    const output = publishedSnapshot(input)
    expect(output.articles.map(article => article.key)).toEqual(["building:one"])
    expect(output.states).toEqual([{ id: "official-shanghai", status: "ok" }])
    expect(Object.keys(output.seen)).toEqual(["official-shanghai"])
    expect(JSON.stringify(output)).not.toContain("never save")
    expect(JSON.stringify(input)).toBe(before)
  })
})
