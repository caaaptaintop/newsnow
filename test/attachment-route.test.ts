import { beforeEach, describe, expect, it, vi } from "vitest"
import handler from "../server/api/intelligence/attachment.post"
import { articleById } from "../server/building/store"
import { reserveRelay } from "../server/building/relay-budget"
import { relayAttachment } from "../server/utils/attachment-relay"

vi.mock("h3", () => ({
  defineEventHandler: (fn: unknown) => fn,
  createError: (input: any) => Object.assign(new Error(input.message), input),
  getHeader: (event: any, name: string) => event.headers[name],
  getRequestURL: () => new URL("https://news.example.com/api/intelligence/attachment"),
  getRequestWebStream: (event: any) => new Response(event.body).body,
  setHeaders: (event: any, headers: unknown) => { event.responseHeaders = headers },
  sendStream: (_event: any, body: unknown) => body,
}))
vi.mock("../server/building/store", () => ({ buildingDB: vi.fn(() => ({})), buildingEnv: () => ({ BUILDING_RATE_SALT: "test-salt" }), articleById: vi.fn(async (_db, key) => key === "known" ? { topic: "building", key: "known", url: "https://demo.gov.cn/article", attachments: [{ title: "附件.doc", url: "https://demo.gov.cn/download?id=1" }, { title: "中文.doc", url: "https://demo.gov.cn/中文.doc" }] } : undefined) }))
vi.mock("../server/building/relay-budget", () => ({ reserveRelay: vi.fn(async () => "lease"), settleRelay: vi.fn(async () => {}) }))
vi.mock("../shared/intelligence-snapshot", () => ({ intelligenceSnapshot: { pipeline: "mac", articles: [{ topic: "building", key: "known", url: "https://demo.gov.cn/article", attachments: [{ title: "附件.doc", url: "https://demo.gov.cn/download?id=1" }, { title: "中文.doc", url: "https://demo.gov.cn/中文.doc" }] }, { topic: "health", key: "known", url: "https://demo.gov.cn/article", attachments: [{ title: "附件.doc", url: "https://demo.gov.cn/download?id=1" }] }] } }))
vi.mock("../server/utils/attachment-relay", async (original) => ({ ...await original<typeof import("../server/utils/attachment-relay")>(), relayAttachment: vi.fn(async () => new Response("document bytes")) }))
const body = { topic: "building", articleKey: "known", url: "https://demo.gov.cn/download?id=1" }
const event = (data: unknown = body, headers = {}) => ({ body: JSON.stringify(data), headers: { "content-type": "application/json", origin: "https://news.example.com", ...headers }, context: {}, responseHeaders: {} })
beforeEach(() => vi.clearAllMocks())

describe("indexed attachment authorization", () => {
  it("uses indexed D1 metadata and reserves relay budget before fetching", async () => {
    const request = event()
    const stream = await handler(request as any)
    expect(await new Response(stream as any).text()).toBe("document bytes")
    expect(articleById).toHaveBeenCalledWith(expect.anything(), "known")
    expect(reserveRelay).toHaveBeenCalledOnce()
    expect(relayAttachment).toHaveBeenCalledWith(expect.objectContaining({ url: body.url, filename: "附件.doc", referer: "https://demo.gov.cn/article" }))
  })
  it("matches canonical Chinese URLs against trusted source metadata", async () => {
    const stream = await handler(event({ ...body, url: "https://demo.gov.cn/%E4%B8%AD%E6%96%87.doc" }) as any)
    expect(await new Response(stream as any).text()).toBe("document bytes")
    expect(relayAttachment).toHaveBeenCalledWith(expect.objectContaining({ url: "https://demo.gov.cn/中文.doc" }))
  })
  it.each([{ ...body, url: "https://demo.gov.cn/other.doc" }, { ...body, articleKey: "wrong" }, { ...body, topic: "health" }])("rejects an unindexed key/topic/URL combination", async (data) => {
    await expect(handler(event(data) as any)).rejects.toMatchObject({ statusCode: 404 })
    expect(relayAttachment).not.toHaveBeenCalled()
  })
  it.each([null, [], { ...body, topic: "__proto__" }, { ...body, url: 1 }, { ...body, articleKey: "x".repeat(201) }])("rejects malformed locators", async (data) => {
    await expect(handler(event(data) as any)).rejects.toMatchObject({ statusCode: 400 })
    expect(relayAttachment).not.toHaveBeenCalled()
  })
  it("rejects cross-site calls and non-JSON bodies", async () => {
    await expect(handler(event(body, { origin: "https://evil.example.com" }) as any)).rejects.toMatchObject({ statusCode: 403 })
    await expect(handler(event(body, { "sec-fetch-site": "cross-site" }) as any)).rejects.toMatchObject({ statusCode: 403 })
    await expect(handler(event(body, { "content-type": "text/plain" }) as any)).rejects.toMatchObject({ statusCode: 415 })
    expect(relayAttachment).not.toHaveBeenCalled()
  })
  it("rejects oversized requests without parsing or forwarding content", async () => {
    await expect(handler(event({ ...body, padding: "x".repeat(9000) }) as any)).rejects.toMatchObject({ statusCode: 413 })
    expect(relayAttachment).not.toHaveBeenCalled()
  })
})
