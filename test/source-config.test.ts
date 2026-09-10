import { afterEach, describe, expect, it, vi } from "vitest"
import { intelligenceSources } from "../shared/official-sources"
import { sourceConfigFromIntelligenceSource, sourceConfigToIntelligenceSource, sourceConfigurationStatus } from "../shared/source-config"
import { normalizeManagedSourceConfig } from "../server/source-admin/model"
import { collectSource } from "../server/utils/intelligence-collector"

afterEach(() => vi.unstubAllGlobals())

describe("managed source configuration", () => {
  it("marks sources without fixed columns as unconfigured legacy discovery", () => {
    const source = intelligenceSources.find(item => item.id === "official-beijing")!
    const config = sourceConfigFromIntelligenceSource(source)
    expect(config.collectionMode).toBe("legacy-discovery")
    expect(sourceConfigurationStatus(config)).toBe("unconfigured")
  })

  it("turns published endpoints into collector columns", () => {
    const base = sourceConfigFromIntelligenceSource(intelligenceSources.find(item => item.id === "official-beijing")!)
    const config = normalizeManagedSourceConfig({
      ...base,
      collectionMode: "explicit",
      endpoints: [{ id: "notice", kind: "notice", name: "通知公告", url: `${base.home}notice/`, enabled: true }],
    })
    const source = sourceConfigToIntelligenceSource(config)
    expect(source.columns).toEqual([{ name: "通知公告", url: `${base.home}notice/` }])
    expect((source as any).collectionMode).toBe("explicit")
  })

  it("rejects private hosts, cross-host columns, duplicate columns and an empty explicit config", () => {
    const source = sourceConfigFromIntelligenceSource(intelligenceSources.find(item => item.id === "official-beijing")!)
    expect(() => normalizeManagedSourceConfig({ ...source, home: "http://127.0.0.1/" })).toThrow(/IP地址/)
    expect(() => normalizeManagedSourceConfig({
      ...source,
      collectionMode: "explicit",
      endpoints: [{ id: "a", kind: "notice", name: "通知公告", url: "https://example.com/a", enabled: true }],
    })).toThrow(/同一主机/)
    expect(() => normalizeManagedSourceConfig({ ...source, collectionMode: "explicit", endpoints: [] })).toThrow(/至少需要/)
    expect(() => normalizeManagedSourceConfig({
      ...source,
      collectionMode: "explicit",
      endpoints: [
        { id: "a", kind: "notice", name: "通知公告", url: `${source.home}a`, enabled: true },
        { id: "a", kind: "policy", name: "政策文件", url: `${source.home}b`, enabled: true },
      ],
    })).toThrow(/编号重复/)
  })

  it("never falls back to the homepage in explicit mode", async () => {
    const base = sourceConfigFromIntelligenceSource(intelligenceSources.find(item => item.id === "official-beijing")!)
    const source = sourceConfigToIntelligenceSource(normalizeManagedSourceConfig({
      ...base,
      collectionMode: "explicit",
      endpoints: [{ id: "notice", kind: "notice", name: "通知公告", url: `${base.home}notice/`, enabled: true }],
    }))
    const fetchMock = vi.fn(async () => new Response("<html><body><a href='/'>首页</a></body></html>", { headers: { "content-type": "text/html" } }))
    vi.stubGlobal("fetch", fetchMock)
    await expect(collectSource(source)).rejects.toThrow(/栏目未解析到文章/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain("notice")
  })
})
