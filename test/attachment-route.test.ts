import { beforeEach, describe, expect, it, vi } from "vitest"
import { backupAttachment } from "../server/utils/attachment-backup"
import { asArrayBuffer, makeFixtures } from "../scripts/attachment-preview-fixtures.mjs"
import handler from "../server/api/intelligence/attachment.post"
import { articleById } from "../server/building/store"
import { reserveRelay } from "../server/building/relay-budget"
import { AttachmentRelayError, relayAttachment } from "../server/utils/attachment-relay"

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
vi.mock("../server/utils/attachment-backup", () => ({ backupAttachment: vi.fn(async () => new Response("backup bytes")) }))
const body = { topic: "building", articleKey: "known", url: "https://demo.gov.cn/download?id=1" }
const event = (data: unknown = body, headers = {}) => ({ body: JSON.stringify(data), headers: { "content-type": "application/json", origin: "https://news.example.com", ...headers }, context: {}, responseHeaders: {} })
beforeEach(() => vi.clearAllMocks())

describe("indexed attachment authorization", () => {
  it("uses indexed D1 metadata and reserves relay budget before fetching", async () => {
    const request = event()
    const stream = await handler(request as any)
    expect(await (stream as Response).text()).toBe("document bytes")
    expect(articleById).toHaveBeenCalledWith(expect.anything(), "known")
    expect(reserveRelay).toHaveBeenCalledOnce()
    expect(relayAttachment).toHaveBeenCalledWith(expect.objectContaining({ url: body.url, filename: "附件.doc", referer: "https://demo.gov.cn/article" }))
  })
  it("matches canonical Chinese URLs against trusted source metadata", async () => {
    const stream = await handler(event({ ...body, url: "https://demo.gov.cn/%E4%B8%AD%E6%96%87.doc" }) as any)
    expect(await (stream as Response).text()).toBe("document bytes")
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

describe("attachment failure and cache authorization", () => {
  it("serves a successful second request from cache while still reserving its budget", async () => {
    const file = makeFixtures().docx
    let saved: Response | undefined
    const cache = { match: vi.fn(async () => saved?.clone()), put: vi.fn(async (_key: Request, response: Response) => {
      saved = response
    }) }
    vi.stubGlobal("caches", { open: vi.fn(async () => cache) })
    vi.mocked(relayAttachment).mockResolvedValueOnce(new Response(asArrayBuffer(file.bytes), { headers: { "Content-Type": file.mime, "Content-Disposition": "inline; filename=test.docx" } }))
    try {
      const first = await handler(event() as any) as Response
      expect(first.headers.get("X-Attachment-Via")).toBe("relay")
      expect(await first.arrayBuffer()).toEqual(asArrayBuffer(file.bytes))
      const second = await handler(event() as any) as Response
      expect(second.headers.get("X-Attachment-Via")).toBe("cache")
      expect(await second.arrayBuffer()).toEqual(asArrayBuffer(file.bytes))
      expect(relayAttachment).toHaveBeenCalledOnce()
      expect(reserveRelay).toHaveBeenCalledTimes(2)
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it("keeps origin failures as readable dependency errors instead of a gateway 502", async () => {
    vi.mocked(relayAttachment).mockRejectedValueOnce(new AttachmentRelayError(502, "原站读取失败"))
    await expect(handler(event() as any)).rejects.toMatchObject({ statusCode: 424, message: "原站读取失败" })
  })
  it("does not return HTTP 200 when an upstream body fails halfway", async () => {
    vi.mocked(relayAttachment).mockResolvedValueOnce(new Response(new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array([1]))
        c.error(new Error("broken body"))
      },
    })))
    await expect(handler(event() as any)).rejects.toMatchObject({ statusCode: 424 })
  })
  it("checks article membership and quota before looking in the cache", async () => {
    const match = vi.fn()
    vi.stubGlobal("caches", { open: vi.fn(async () => ({ match })) })
    try {
      await expect(handler(event({ ...body, articleKey: "deleted" }) as any)).rejects.toMatchObject({ statusCode: 404 })
      expect(match).not.toHaveBeenCalled()
      vi.mocked(reserveRelay).mockRejectedValueOnce(new Error("quota unavailable"))
      await expect(handler(event() as any)).rejects.toMatchObject({ statusCode: 424 })
      expect(match).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe("diagnosed cloud origin fallback", () => {
  it.each([530, 403, 429, 500])("only uses backup for the diagnosed 530 origin failure (%s)", async (status) => {
    const url = "https://www.mohurd.gov.cn/api-gateway/jpaas-web-server/front/document/download?fileName=a.docx"
    vi.mocked(articleById).mockResolvedValueOnce({ key: "known", url: "https://www.mohurd.gov.cn/article", attachments: [{ title: "a.docx", url }] } as any)
    vi.mocked(relayAttachment).mockRejectedValueOnce(new AttachmentRelayError(502, "origin", status))
    if (status === 530) {
      const response = await handler(event({ ...body, url }) as any) as Response
      expect(await response.text()).toBe("backup bytes")
      expect(backupAttachment).toHaveBeenCalledOnce()
    } else {
      await expect(handler(event({ ...body, url }) as any)).rejects.toMatchObject({ statusCode: 424 })
      expect(backupAttachment).not.toHaveBeenCalled()
    }
  })
})
