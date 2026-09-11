import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { officialIntelligenceSources } from "../shared/official-sources"
import { intelligenceSourceSeedConfig, sourceConfigEnvelope } from "../shared/source-config"
import { collectSource } from "../tools/ai-bridge/collect-source"
import { resetPublishedSourceConfigForTests } from "../tools/ai-bridge/source-config-client"

const previousFile = process.env.CAPX_SOURCE_CONFIG_FILE

describe("published source configuration", () => {
  afterEach(() => {
    vi.restoreAllMocks()
    resetPublishedSourceConfigForTests()
    if (previousFile === undefined) delete process.env.CAPX_SOURCE_CONFIG_FILE
    else process.env.CAPX_SOURCE_CONFIG_FILE = previousFile
  })

  it("uses an explicit published endpoint and never falls back to the homepage", async () => {
    const directory = mkdtempSync(join(tmpdir(), "source-config-"))
    try {
      const file = join(directory, "source-config.json")
      const source = officialIntelligenceSources.find(item => item.id === "official-beijing")!
      const config = intelligenceSourceSeedConfig(source)
      config.collectionMode = "explicit"
      config.endpoints = [{
        id: "notice",
        kind: "notice",
        name: "通知公告",
        url: "https://zjw.beijing.gov.cn/notices/",
        enabled: true,
      }]
      writeFileSync(file, JSON.stringify(await sourceConfigEnvelope([config])))
      process.env.CAPX_SOURCE_CONFIG_FILE = file
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html><body><a href='/index.shtml'>首页</a></body></html>", { headers: { "content-type": "text/html" } }))
      await expect(collectSource(source)).rejects.toThrow(/栏目未解析到文章/)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(String(fetchMock.mock.calls[0][0])).toBe(config.endpoints[0].url)
    }
    finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("collects every explicitly configured column beyond the legacy four-column limit", async () => {
    const directory = mkdtempSync(join(tmpdir(), "source-config-"))
    try {
      const file = join(directory, "source-config.json")
      const source = officialIntelligenceSources.find(item => item.id === "official-beijing")!
      const config = intelligenceSourceSeedConfig(source)
      config.collectionMode = "explicit"
      config.endpoints = Array.from({ length: 6 }, (_value, index) => ({
        id: `notice-${index}`,
        kind: "notice" as const,
        name: `通知公告${index}`,
        url: `https://zjw.beijing.gov.cn/notices/${index}/`,
        enabled: true,
      }))
      writeFileSync(file, JSON.stringify(await sourceConfigEnvelope([config])))
      process.env.CAPX_SOURCE_CONFIG_FILE = file
      const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
        const index = Number(String(url).split("/").filter(Boolean).at(-1))
        return new Response(`<ul><li><a href="/article_${index}.html">建筑栏目完整覆盖合成测试文章${index}</a><time>2026-09-10</time></li></ul>`, {
          headers: { "content-type": "text/html" },
        })
      })
      const result = await collectSource(source)
      expect(fetchMock).toHaveBeenCalledTimes(6)
      expect(result.items).toHaveLength(6)
      expect(result.warnings).toEqual([])
      expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual(config.endpoints.map(endpoint => endpoint.url))
    }
    finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
