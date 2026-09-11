import { afterEach, describe, expect, it, vi } from "vitest"
import { sourceFetchError } from "../server/utils/source-fetch-diagnostic"
import { intelligenceFetchHtml } from "../server/utils/intelligence-parser"
import { intelligenceFetchList, intelligenceJPaasUnitUrl } from "../server/utils/intelligence-dynamic-list"
import { sourceTestResultScript } from "../server/source-admin/test-result-view"
import { sourceAdminPage } from "../server/source-admin/page"
import { sourceTestAllowsPublish, sourceTestNeedsRuntimeFallback, testSourceConfig } from "../server/source-admin/test-source-config"
import { intelligenceSources } from "../shared/official-sources"
import { intelligenceSourceSeedConfig } from "../shared/source-config"

const sourceTestResultView = new Function(`${sourceTestResultScript}; return renderSourceTestView`)() as (input: unknown) => string

const seed = intelligenceSources.find(source => source.id === "official-mohurd")!
const config = { ...intelligenceSourceSeedConfig(seed), collectionMode: "explicit" as const,
  endpoints: ["政策发布", "建设要闻", "标准公告", "标准征求意见"].map((name, index) => ({
    id: `synthetic-${index}`, kind: "notice" as const, name, url: `${seed.home}synthetic-${index}/index.html`, enabled: true,
  })) }
afterEach(() => vi.restoreAllMocks())

describe("upstream diagnostics without body persistence or retries", () => {
  it("preserves Cloudflare 1016 header and cancels the body", async () => {
    const response = new Response("arbitrary origin text must not be retained", { status: 530, headers: { "cf-error-type": "1016" } })
    const cancel = vi.spyOn(response.body!, "cancel")
    const error = await sourceFetchError(response)
    expect(error.diagnostic).toEqual({ stage: "fetch", httpStatus: 530, category: "cloudflare_dns", cloudflareCode: "1016", evidence: "header" })
    expect(error.message).toContain("不能据此判定栏目地址错误")
    expect(JSON.stringify(error)).not.toContain("arbitrary origin")
    expect(cancel).toHaveBeenCalledOnce()
  })
  it.each([
    "error code: 1016",
    "<html><title>Cloudflare</title><h1>Error <span>1016</span></h1></html>",
  ])("extracts only the code from a synthetic error body", async (body) => {
    const response = new Response(body, { status: 530, headers: { "content-type": "text/html" } })
    const error = await sourceFetchError(response)
    expect(error.diagnostic.cloudflareCode).toBe("1016")
    expect(error.diagnostic.evidence).toBe("body")
    expect(JSON.stringify(error)).not.toContain("<html>")
  })
  it("keeps other Cloudflare errors distinct from DNS 1016", async () => {
    const error = await sourceFetchError(new Response("error code: 1020", { status: 530 }))
    expect(error.diagnostic.cloudflareCode).toBe("1020")
    expect(error.diagnostic.category).toBe("http_530")
  })
  it("does not fabricate a provider code from arbitrary or oversized text", async () => {
    for (const body of ["customer reference 1016", "x".repeat(8200) + "Cloudflare Error 1016"]) {
      const error = await sourceFetchError(new Response(body, { status: 530 }))
      expect(error.diagnostic.cloudflareCode).toBeUndefined()
      expect(error.diagnostic.evidence).toBe("status")
    }
  })
  it("bounded diagnostic reading cancels after the prefix", async () => {
    let pulls = 0, canceled = false
    const body = new ReadableStream({ pull(controller) { pulls++; controller.enqueue(new Uint8Array(5000).fill(120)) }, cancel() { canceled = true } })
    const error = await sourceFetchError(new Response(body, { status: 530, headers: { "content-type": "text/plain" } }))
    expect(canceled).toBe(true)
    expect(pulls).toBeLessThanOrEqual(4)
    expect(error.diagnostic.cloudflareCode).toBeUndefined()
  })
  it("does not hang on a stalled diagnostic body", async () => {
    let canceled = false
    const body = new ReadableStream({ cancel() { canceled = true } })
    const error = await sourceFetchError(new Response(body, { status: 530 }))
    expect(canceled).toBe(true)
    expect(error.diagnostic.httpStatus).toBe(530)
  })
  it.each([[403, "access_denied"], [412, "access_denied"], [429, "rate_limited"], [404, "not_found"], [502, "http_error"]])("categorizes HTTP %s without an error-body read", async (status, category) => {
    const response = new Response("not persisted", { status: Number(status) })
    const error = await sourceFetchError(response)
    expect(error.diagnostic.category).toBe(category)
    expect(JSON.stringify(error)).not.toContain("not persisted")
  })
  it("actual parser fetch surfaces metadata and never retries or downgrades", async () => {
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("error code: 1016", { status: 530 }))
    await expect(intelligenceFetchHtml(config.endpoints[0].url, seed)).rejects.toMatchObject({ diagnostic: { httpStatus: 530, cloudflareCode: "1016" } })
    expect(mock).toHaveBeenCalledOnce()
    expect(mock.mock.calls[0][0]).toBe(config.endpoints[0].url)
  })
  it("reports each failed column and retains the strict publication gate", async () => {
    const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("error code: 1016", { status: 530 }))
    const result = await testSourceConfig(config)
    expect(result.endpoints).toHaveLength(4)
    expect(result.endpoints.every(item => !item.ok && item.diagnostic?.cloudflareCode === "1016")).toBe(true)
    for (const endpoint of config.endpoints) expect(result.message).toContain(endpoint.name)
    expect(sourceTestAllowsPublish(config, result)).toBe(false)
    expect(mock).toHaveBeenCalledTimes(4)
  })
})

describe("human-readable column test results", () => {
  const result = { mode: "explicit", publishable: false, message: "当前草稿不能发布", endpoints: config.endpoints.map(item => ({
    ...item, ok: false, count: 0, preview: [], message: "目标主机解析失败", diagnostic: { httpStatus: 530, cloudflareCode: "1016" },
  })) }
  it("names all failed columns, shows status codes and collapses raw JSON", () => {
    const html = sourceTestResultView(result)
    expect(html).toContain("已通过 0 / 4 个栏目；未通过 4 个")
    expect(html).toContain("HTTP 530 / Cloudflare 1016")
    expect(html).toContain("当前为云端测试")
    for (const item of config.endpoints) expect(html).toContain(`<b>${item.name}</b>`)
    expect(html).toContain('<details class="source-test-raw">')
    expect(html).not.toContain('<details open')
  })
  it("explains queued Mac verification without treating DNS failure as a bad URL", () => {
    const html = sourceTestResultView({ ...result, executor: "cloud", runtimePending: true })
    expect(html).toContain("等待本机复核")
    expect(html).toContain("已排队等待 Mac 后台自然周期复核")
    expect(html).toContain("无需重复点击测试")
  })
  it("labels a signed Mac result distinctly from a cloud test", () => {
    const html = sourceTestResultView({ ...result, executor: "mac", runtimePending: false })
    expect(html).toContain("已登记签名身份的 Mac 运行环境")
  })
  it("distinguishes passed, failed and untested columns", () => {
    const html = sourceTestResultView({ ...result, endpoints: [
      { ...result.endpoints[0], ok: true, count: 1 }, result.endpoints[1], { ...result.endpoints[2], status: "untested" },
    ] })
    expect(html).toContain("已通过 1 / 3 个栏目；未通过 1 个；未测试 1 个")
  })
  it("escapes all result text and rejects script links", () => {
    const html = sourceTestResultView({ message: "<script>alert(1)</script>", endpoints: [{ id: '<img src=x>', name: '<img src=x>', url: 'javascript:alert(1)', message: '<svg onload=alert(1)>', preview: [{ title: '<iframe>', url: 'data:text/html,hi' }] }] })
    expect(html).not.toMatch(/<(script|img|svg|iframe)\b/)
    expect(html).not.toMatch(/href="(?:javascript|data):/)
  })
  it("the renderer embedded in the shipped script has no external dependencies", () => {
    const html = sourceAdminPage("synthetic-owner@example.com", "synthetic")
    expect(html).toContain(sourceTestResultScript)
    const render = new Function(`${sourceTestResultScript}; return renderSourceTestView`)() as typeof sourceTestResultView
    expect(render(result)).toBe(sourceTestResultView(result))
  })
})


describe("JPaas dynamic government list hydration", () => {
  const staticHtml = `<!doctype html><html><head><title>政策发布</title></head><body>
    <script>
      const endpoint = "/api-gateway/jpaas-publish-server/front/page/build/unit";
      const unit = { parseType: "bulidstatic", webId: "86ca573ec4df405db627fdc2493677f3",
        tplSetId: "fc259c381af3496d85e61997ea7771cb", pageType: "column", tagId: "栏目-list",
        editType: null, pageId: "8soTiiRMg3k87m5e2CQit" };
    </script>
  </body></html>`
  it("extracts a same-host bounded unit URL without evaluating page scripts", () => {
    const url = intelligenceJPaasUnitUrl(staticHtml, seed, `${seed.home}zhengcefabu/index.html`)
    expect(url).toBeTruthy()
    const parsed = new URL(url!)
    expect(parsed.origin).toBe(new URL(seed.home).origin)
    expect(parsed.pathname).toBe("/api-gateway/jpaas-publish-server/front/page/build/unit")
    expect(parsed.searchParams.get("parseType")).toBe("bulidstatic")
    expect(parsed.searchParams.get("tagId")).toBe("栏目-list")
    expect(parsed.searchParams.get("pageId")).toBe("8soTiiRMg3k87m5e2CQit")
    expect(parsed.searchParams.get("editType")).toBe("null")
  })
  it("hydrates data.html once and feeds the existing list parser", async () => {
    const fragment = `<ul>
      <li><a href="/zhengcefabu/art/2026/art_one.html">关于举办2026年数据要素大赛全国总决赛的通知</a><span>2026-09-08</span></li>
      <li><a href="/zhengcefabu/art/2026/art_two.html">住房城乡建设部办公厅关于合成回归事项的通知</a><span>2026-09-07</span></li>
    </ul>`
    const mock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(staticHtml, { status: 200, headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: { html: fragment } }), { status: 200, headers: { "content-type": "application/json;charset=UTF-8" } }))
    const column = { name: "政策发布", url: `${seed.home}zhengcefabu/index.html` }
    const page = await intelligenceFetchList(column.url, seed, column)
    expect(page.items).toHaveLength(2)
    expect(page.items[0].publishedAt).toBeTruthy()
    expect(mock).toHaveBeenCalledTimes(2)
    expect(String(mock.mock.calls[1][0])).toContain("/api-gateway/jpaas-publish-server/front/page/build/unit?")
  })
})

describe("cloud DNS fallback classification", () => {
  it("queues only explicit tests whose enabled columns all failed at Cloudflare DNS", () => {
    const cloud = { schemaVersion: 1 as const, mode: "explicit", ok: false, publishable: false, message: "dns",
      endpoints: config.endpoints.map(endpoint => ({ ...endpoint, ok: false, count: 0, preview: [], status: "failed" as const, message: "dns", diagnostic: { stage: "fetch" as const, httpStatus: 530, category: "cloudflare_dns" as const, cloudflareCode: "1016", evidence: "body" as const } })) }
    expect(sourceTestNeedsRuntimeFallback(cloud)).toBe(true)
    expect(sourceTestNeedsRuntimeFallback({ ...cloud, endpoints: cloud.endpoints.map((endpoint, index) => index ? endpoint : { ...endpoint, diagnostic: undefined, message: "栏目页未解析到文章" }) })).toBe(false)
  })
})
