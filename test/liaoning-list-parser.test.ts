import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { testSourceConfig } from "../server/source-admin/test-source-config"
import { intelligenceParseList } from "../server/utils/intelligence-parser"
import { intelligenceSources } from "../shared/official-sources"
import { intelligenceSourceSeedConfig } from "../shared/source-config"

const source = intelligenceSources.find(item => item.id === "official-liaoning")!

const fixtures = [
  {
    file: "gfxwj.html",
    name: "规范性文件",
    path: "/zjt/tfwj/gfxwj/",
    firstTitle: "辽宁省住房和城乡建设厅关于全面做好行政处罚信息公开公示工作的若干举措",
  },
  {
    file: "tftz.html",
    name: "厅发通知",
    path: "/zjt/tftz/",
    firstTitle: "关于开展工程造价改革工作书面调研的函",
  },
  {
    file: "gsgg.html",
    name: "公示公告",
    path: "/zjt/gsgg/",
    firstTitle: "关于2026年第三十五批建筑施工企业安全生产许可证（核发）审查情况的公示",
  },
  {
    file: "zcjd.html",
    name: "政策解读",
    path: "/zjt/zcjd/",
    firstTitle: "《关于发布2024年辽宁省建设工程 计价依据人工费动态调整指数 和材料价格综合指数的通知》的政策解读",
  },
] as const

function fixture(name: string) {
  return readFileSync(join(process.cwd(), "test/fixtures/liaoning", name), "utf8")
}

afterEach(() => vi.restoreAllMocks())

describe("liaoning current-column list scope", () => {
  for (const testCase of fixtures) {
    it(`keeps ${testCase.name} inside its real article list`, () => {
      const column = source.columns!.find(item => item.name === testCase.name)!
      const items = intelligenceParseList(fixture(testCase.file), source, column)

      expect(items.length).toBeGreaterThanOrEqual(2)
      expect(items[0].title).toBe(testCase.firstTitle)
      expect(items.every(item => new URL(item.url).pathname.startsWith(testCase.path))).toBe(true)
      expect(items.some(item => new URL(item.url).pathname.startsWith("/zjt/zmhd94/yjzj/"))).toBe(false)
    })
  }

  it("shows distinct real previews for all four configured columns", async () => {
    const pages = new Map(source.columns!.map((column, index) => [column.url, fixture(fixtures[index].file)]))
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const body = pages.get(String(input))
      return new Response(body ?? "not found", { status: body ? 200 : 404, headers: { "content-type": "text/html;charset=utf-8" } })
    })
    const config = intelligenceSourceSeedConfig(source)
    const result = await testSourceConfig(config)

    expect(result.publishable).toBe(true)
    expect(result.endpoints).toHaveLength(4)
    for (const [index, endpoint] of result.endpoints.entries()) {
      expect(endpoint.preview[0]?.title).toBe(fixtures[index].firstTitle)
      expect(endpoint.preview.every(item => new URL(item.url).pathname.startsWith(fixtures[index].path))).toBe(true)
    }
    const previewUrls = result.endpoints.flatMap(endpoint => endpoint.preview.map(item => item.url))
    expect(new Set(previewUrls).size).toBe(previewUrls.length)
  })

  it("does not narrow a page from one coincidental same-path link", () => {
    const synthetic = { id: "official-example", home: "https://example.gov.cn/" } as any
    const column = { name: "通知公告", url: "https://example.gov.cn/xxgk/tzgg/index.shtml" }
    const html = `
      <a href="/xxgk/tzgg/related.html">关于当前栏目入口调整事项的说明</a>
      <a href="/published/one.html">关于推进城市更新试点工作的通知</a>
      <a href="/published/two.html">关于公布智能建造项目名单的通知</a>`
    const items = intelligenceParseList(html, synthetic, column)
    expect(items.map(item => item.url)).toEqual([
      "https://example.gov.cn/xxgk/tzgg/related.html",
      "https://example.gov.cn/published/one.html",
      "https://example.gov.cn/published/two.html",
    ])
  })
})
