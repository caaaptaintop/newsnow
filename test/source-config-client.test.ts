import { afterEach, describe, expect, it, vi } from "vitest"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { officialIntelligenceSources } from "../shared/official-sources"
import { intelligenceSourceSeedConfig } from "../shared/source-config"
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
      writeFileSync(file, JSON.stringify({
        schemaVersion: 1,
        topic: "building",
        revision: 1,
        generatedAt: Date.now(),
        sources: [config],
      }))
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
})
