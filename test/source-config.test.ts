import { describe, expect, it } from "vitest"
import { officialIntelligenceSources } from "../shared/official-sources"
import { applyIntelligenceSourceConfig, intelligenceSourceConfigHash, intelligenceSourceSeedConfig, validateIntelligenceSourceConfig } from "../shared/source-config"

describe("source configuration", () => {
  const seed = officialIntelligenceSources.find(source => source.id === "official-beijing")!

  it("keeps identity immutable and requires official same-host endpoints", () => {
    const value = intelligenceSourceSeedConfig(seed)
    value.collectionMode = "explicit"
    value.endpoints = [{
      id: "official-beijing:notice:1",
      kind: "notice",
      name: "通知公告",
      url: "https://zjw.beijing.gov.cn/bjjs/zwgk/tzgg/index.shtml",
      enabled: true,
    }]
    const checked = validateIntelligenceSourceConfig(value, seed)
    expect(checked.id).toBe(seed.id)
    expect(checked.endpoints).toHaveLength(1)
    expect(() => validateIntelligenceSourceConfig({ ...value, home: "https://example.com/" }, seed)).toThrow(/gov.cn/)
    expect(() => validateIntelligenceSourceConfig({ ...value, endpoints: [{ ...value.endpoints[0], url: "https://other.gov.cn/list.shtml" }] }, seed)).toThrow(/同一主机/)
  })

  it("applies explicit published columns without changing the seed object", async () => {
    const config = intelligenceSourceSeedConfig(seed)
    config.collectionMode = "explicit"
    config.endpoints = [{ id: "notice", kind: "notice", name: "通知公告", url: "https://zjw.beijing.gov.cn/bjjs/zwgk/tzgg/index.shtml", enabled: true }]
    const normalized = validateIntelligenceSourceConfig(config, seed)
    const applied = applyIntelligenceSourceConfig(seed, normalized)
    expect(applied.columns).toEqual([{ name: "通知公告", url: normalized.endpoints[0].url }])
    expect(applied.collectionMode).toBe("explicit")
    expect(seed.columns).toBeUndefined()
    await expect(intelligenceSourceConfigHash(normalized)).resolves.toMatch(/^[a-f0-9]{64}$/)
  })
})
