import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { testSourceConfig } from "../server/source-admin/test-source-config"
import { intelligenceFetchList } from "../server/utils/intelligence-dynamic-list"
import { intelligenceSources } from "../shared/official-sources"
import { intelligenceSourceSeedConfig } from "../shared/source-config"

const source = intelligenceSources.find(item => item.id === "official-hubei")!
const cases = [
  {
    id: "gfxwj",
    name: "规范性文件",
    pageUrl: "https://zjt.hubei.gov.cn/zfxxgk/zc/gfxwj/",
    jsonUrl: "https://zjt.hubei.gov.cn/zfxxgk/zc/gfxwj/zcwj.json",
    firstTitle: "省住建厅关于公布行政规范性文件清理结果的通知",
    articlePath: "/zfxxgk/zc/gfxwj/",
  },
  {
    id: "qtzdgkwj",
    name: "其他公开文件",
    pageUrl: "https://zjt.hubei.gov.cn/zfxxgk/zc/qtzdgkwj/",
    jsonUrl: "https://zjt.hubei.gov.cn/zfxxgk/zc/qtzdgkwj/zcwj.json",
    firstTitle: "关于征求《湖北省乡村建设工匠培训考核实施细则（试行）（征求意见稿）》意见的函",
    articlePath: "/zfxxgk/zc/qtzdgkwj/",
  },
] as const

function fixture(name: string) {
  return readFileSync(join(process.cwd(), "test/fixtures/hubei", name), "utf8")
}

function responseFor(testCase: (typeof cases)[number], input: unknown) {
  const url = String(input)
  if (url === testCase.pageUrl) return new Response(fixture(`${testCase.id}.html`), { headers: { "content-type": "text/html;charset=utf-8" } })
  if (url === testCase.jsonUrl) return new Response(fixture(`${testCase.id}.json`), { headers: { "content-type": testCase.id === "qtzdgkwj" ? "text/plain;charset=utf-8" : "application/json;charset=utf-8" } })
  return new Response("not found", { status: 404 })
}

afterEach(() => vi.restoreAllMocks())

describe("hubei structured government lists", () => {
  for (const testCase of cases) {
    it(`uses the official ${testCase.name} JSON instead of institution sidebar links`, async () => {
      const mock = vi.spyOn(globalThis, "fetch").mockImplementation(input => Promise.resolve(responseFor(testCase, input)))
      const page = await intelligenceFetchList(testCase.pageUrl, source, { name: testCase.name, url: testCase.pageUrl })

      expect(mock).toHaveBeenCalledTimes(2)
      expect(String(mock.mock.calls[1][0])).toBe(testCase.jsonUrl)
      expect(page.items[0]?.title).toBe(testCase.firstTitle)
      expect(page.items[0]?.publishedAt).toBeTruthy()
      expect(page.items.every(item => new URL(item.url).pathname.startsWith(testCase.articlePath))).toBe(true)
      expect(page.items.some(item => item.title.includes("机关后勤服务中心") || item.title.includes("建筑事业发展中心"))).toBe(false)
    })
  }

  it("fails closed when a recognized structured list returns malformed JSON", async () => {
    const testCase = cases[0]
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === testCase.pageUrl) return responseFor(testCase, input)
      if (String(input) === testCase.jsonUrl) return new Response("not-json", { headers: { "content-type": "application/json" } })
      return new Response("not found", { status: 404 })
    })
    await expect(intelligenceFetchList(testCase.pageUrl, source, { name: testCase.name, url: testCase.pageUrl })).rejects.toThrow(/JSON|结构化/)
  })

  it("fails closed instead of following redirects from a recognized structured endpoint", async () => {
    const testCase = cases[0]
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === testCase.pageUrl) return responseFor(testCase, input)
      if (String(input) === testCase.jsonUrl) return new Response(null, { status: 302, headers: { location: `${source.home}other.json` } })
      return new Response("not found", { status: 404 })
    })
    await expect(intelligenceFetchList(testCase.pageUrl, source, { name: testCase.name, url: testCase.pageUrl })).rejects.toThrow(/跳转|结构化/)
  })

  it.each([
    ["wrong MIME", () => new Response("{}", { headers: { "content-type": "text/html" } }), /JSON/],
    ["invalid UTF-8", () => new Response(new Uint8Array([0xFF, 0xFE, 0xFD]), { headers: { "content-type": "application/json" } }), /UTF-8/],
    ["oversized response", () => new Response("{}", { headers: { "content-type": "application/json", "content-length": String(4 * 1024 * 1024 + 1) } }), /大小上限/],
    ["wrong schema", () => new Response(JSON.stringify({ data: {} }), { headers: { "content-type": "application/json" } }), /数据范围|格式/],
  ])("fails closed on %s", async (_label, makeBadResponse, expected) => {
    const testCase = cases[0]
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === testCase.pageUrl) return responseFor(testCase, input)
      if (String(input) === testCase.jsonUrl) return (makeBadResponse as () => Response)()
      return new Response("not found", { status: 404 })
    })
    await expect(intelligenceFetchList(testCase.pageUrl, source, { name: testCase.name, url: testCase.pageUrl })).rejects.toThrow(expected as RegExp)
  })

  it("rejects off-host records while keeping valid same-site documents", async () => {
    const testCase = cases[0]
    const payload = JSON.parse(fixture("gfxwj.json"))
    payload.data.splice(1, 0, { ...payload.data[0], FILENAME: "跨站伪造文件", URL: "https://example.com/off-host.shtml" })
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === testCase.pageUrl) return responseFor(testCase, input)
      if (String(input) === testCase.jsonUrl) return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } })
      return new Response("not found", { status: 404 })
    })
    const page = await intelligenceFetchList(testCase.pageUrl, source, { name: testCase.name, url: testCase.pageUrl })
    expect(page.items[0]?.title).toBe(testCase.firstTitle)
    expect(page.items.some(item => item.title === "跨站伪造文件")).toBe(false)
  })

  it("uses the CMS template independently of source id or endpoint name", async () => {
    const testCase = cases[0]
    const sameSite = { ...source, id: "official-template-regression" }
    const mock = vi.spyOn(globalThis, "fetch").mockImplementation(input => Promise.resolve(responseFor(testCase, input)))
    const page = await intelligenceFetchList(testCase.pageUrl, sameSite, { name: "任意栏目名", url: testCase.pageUrl })
    expect(page.items[0]?.title).toBe(testCase.firstTitle)
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it("feeds real structured previews through the source-admin test contract", async () => {
    const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      for (const testCase of cases) {
        if ([testCase.pageUrl, testCase.jsonUrl].includes(String(input) as any)) return responseFor(testCase, input)
      }
      return new Response("not found", { status: 404 })
    })
    const config = intelligenceSourceSeedConfig(source)
    config.collectionMode = "explicit"
    config.endpoints = cases.map((testCase, index) => ({ id: `hubei:${testCase.id}:${index}`, kind: "policy" as const, name: testCase.name, url: testCase.pageUrl, enabled: true }))
    const result = await testSourceConfig(config)

    expect(result.publishable).toBe(true)
    expect(result.endpoints.map(endpoint => endpoint.preview[0]?.title)).toEqual(cases.map(testCase => testCase.firstTitle))
    expect(result.endpoints.flatMap(endpoint => endpoint.preview).some(item => item.title.includes("机关后勤服务中心"))).toBe(false)
    expect(mock).toHaveBeenCalledTimes(4)
  })
})
