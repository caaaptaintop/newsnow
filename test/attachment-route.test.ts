import { beforeEach, describe, expect, it, vi } from "vitest"
import { backupAttachment } from "../server/utils/attachment-backup"
import { asArrayBuffer, makeFixtures } from "../scripts/attachment-preview-fixtures.mjs"
import handler from "../server/api/intelligence/attachment.post"
import { articleById } from "../server/building/store"
import { reserveRelay, settleRelay } from "../server/building/relay-budget"
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

describe("downstream delivery leases", () => {
  it.each(["relay", "cache"])("holds both slots and leases while a %s consumer pauses, then cancels or reads EOF", async (via) => {
    if (via === "cache") vi.stubGlobal("caches", { open: async () => ({ match: async () => new Response(new Uint8Array(131072), { headers: { "X-Attachment-Expires": String(Date.now() + 300000), "Content-Length": "131072" } }) }) })
    else vi.mocked(relayAttachment).mockResolvedValue(new Response(new Uint8Array(131072)))
    try {
      const first = await handler(event() as any) as Response
      // Each origin response must be independently readable.
      if (via === "relay") vi.mocked(relayAttachment).mockResolvedValue(new Response(new Uint8Array(131072)))
      const second = await handler(event() as any) as Response
      const reader = first.body!.getReader()
      expect((await reader.read()).value!.byteLength).toBe(65536)
      expect(settleRelay).not.toHaveBeenCalled()
      await expect(handler(event() as any)).rejects.toMatchObject({ statusCode: 429 })
      await reader.cancel()
      expect(settleRelay).toHaveBeenCalledTimes(1)
      expect(settleRelay).toHaveBeenLastCalledWith(expect.anything(), "lease", 131072, true)
      await second.arrayBuffer()
      expect(settleRelay).toHaveBeenCalledTimes(2)
      expect(settleRelay).toHaveBeenLastCalledWith(expect.anything(), "lease", 131072, false)
    } finally {
      vi.unstubAllGlobals()
      vi.mocked(relayAttachment).mockImplementation(async () => new Response("document bytes"))
    }
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function flushDeadlineWork() {
  // Includes async hashing/cache lookup without advancing the deadline clock.
  for (let i = 0; i < 4; i++) await new Promise<void>(resolve => setImmediate(resolve))
}

describe("whole request deadline", () => {
  it.each(["open", "match", "body"])("terminates a stalled cache %s before HTTP 200 and disposes late results", async (stage) => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    const pending = deferred<any>()
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }), { headers: { "X-Attachment-Expires": String(Date.now() + 300000), "Content-Length": "100" } })
    const match = vi.fn(() => stage === "match" ? pending.promise : Promise.resolve(response))
    const cache = { match }
    const open = vi.fn(() => stage === "open" ? pending.promise : Promise.resolve(cache))
    vi.stubGlobal("caches", { open })
    let result: unknown
    const request = handler(event() as any).then((value) => {
      result = value
    }, (error) => {
      result = error
    })
    try {
      await flushDeadlineWork()
      expect(open).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(75000)
      expect(result).toMatchObject({ statusCode: 424 })
      expect(settleRelay).toHaveBeenCalledOnce()
      expect(relayAttachment).not.toHaveBeenCalled()
      if (stage === "open") pending.resolve(cache)
      if (stage === "match") pending.resolve(response)
      await flushDeadlineWork()
      expect(relayAttachment).not.toHaveBeenCalled()
      expect(backupAttachment).not.toHaveBeenCalled()
      if (stage === "open") expect(match).not.toHaveBeenCalled()
      else expect(cancel).toHaveBeenCalledOnce()
      expect(settleRelay).toHaveBeenCalledOnce()
      // Both instance slots remain usable after the expired request is discarded.
      vi.unstubAllGlobals()
      const first = await handler(event() as any) as Response
      const second = await handler(event() as any) as Response
      await first.body!.cancel()
      await second.body!.cancel()
      await request
    } finally {
      pending.resolve(stage === "open" ? cache : response)
      await response.body?.cancel().catch(() => {})
      await flushDeadlineWork()
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it("releases slots on a stalled D1 reserve and settles a late lease once without starting cache or origin", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    const pending = deferred<Awaited<ReturnType<typeof reserveRelay>>>()
    const lateLease = "00000000-0000-4000-8000-000000000088"
    vi.mocked(reserveRelay).mockReturnValueOnce(pending.promise)
    const open = vi.fn()
    vi.stubGlobal("caches", { open })
    let result: unknown
    const request = handler(event() as any).then((value) => {
      result = value
    }, (error) => {
      result = error
    })
    try {
      await flushDeadlineWork()
      expect(reserveRelay).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(75000)
      expect(result).toMatchObject({ statusCode: 424 })
      expect(settleRelay).not.toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
      pending.resolve(lateLease)
      await flushDeadlineWork()
      expect(settleRelay).toHaveBeenCalledExactlyOnceWith(expect.anything(), lateLease, 0, true)
      expect(open).not.toHaveBeenCalled()
      expect(relayAttachment).not.toHaveBeenCalled()
      await request
    } finally {
      pending.resolve(lateLease)
      await flushDeadlineWork()
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it("rejects at the exact deadline even when the timer callback has not run", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    const pending = deferred<Response>()
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }), { headers: { "X-Attachment-Expires": String(Date.now() + 300000), "Content-Length": "100" } })
    const match = vi.fn(() => pending.promise)
    vi.stubGlobal("caches", { open: async () => ({ match }) })
    let result: unknown
    const request = handler(event() as any).then((value) => {
      result = value
    }, (error) => {
      result = error
    })
    try {
      await flushDeadlineWork()
      expect(match).toHaveBeenCalledOnce()
      vi.setSystemTime(Date.now() + 75000)
      pending.resolve(response)
      await flushDeadlineWork()
      expect(result).toMatchObject({ statusCode: 424 })
      expect(cancel).toHaveBeenCalledOnce()
      expect(relayAttachment).not.toHaveBeenCalled()
      expect(settleRelay).toHaveBeenCalledOnce()
      await request
    } finally {
      pending.resolve(response)
      await response.body?.cancel().catch(() => {})
      await vi.runOnlyPendingTimersAsync()
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})

describe("deadline propagation", () => {
  it("keeps the original deadline after a slow cache open and during downstream delivery", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    const pending = deferred<any>()
    const open = vi.fn(() => pending.promise)
    vi.stubGlobal("caches", { open })
    const request = handler(event() as any)
    try {
      await flushDeadlineWork()
      expect(open).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(60000)
      pending.resolve({ match: async () => new Response(new Uint8Array(100), { headers: { "X-Attachment-Expires": String(Date.now() + 300000), "Content-Length": "100" } }) })
      const response = await request as Response
      const reader = response.body!.getReader()
      await reader.read() // Last chunk, deliberately do not request EOF.
      await vi.advanceTimersByTimeAsync(14999)
      expect(settleRelay).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" })
      expect(settleRelay).toHaveBeenCalledExactlyOnceWith(expect.anything(), "lease", 100, true)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it("aborts a pending cache match immediately and cancels its late body without fallback", async () => {
    const abort = new AbortController()
    const pending = deferred<Response>()
    const cancel = vi.fn()
    const match = vi.fn(() => pending.promise)
    vi.stubGlobal("caches", { open: async () => ({ match }) })
    const request = handler({ ...event(), web: { request: { signal: abort.signal } } } as any)
    const rejected = expect(request).rejects.toMatchObject({ statusCode: 424 })
    try {
      await flushDeadlineWork()
      expect(match).toHaveBeenCalledOnce()
      abort.abort()
      await rejected
      pending.resolve(new Response(new ReadableStream({ cancel }), { headers: { "X-Attachment-Expires": String(Date.now() + 300000), "Content-Length": "100" } }))
      await flushDeadlineWork()
      expect(cancel).toHaveBeenCalledOnce()
      expect(settleRelay).toHaveBeenCalledExactlyOnceWith(expect.anything(), "lease", 0, true)
      expect(relayAttachment).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it("cancels a late origin response and retains unknown consumption after a deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    const pending = deferred<Response>()
    const cancel = vi.fn()
    vi.mocked(relayAttachment).mockReturnValueOnce(pending.promise)
    const request = handler(event() as any)
    const rejected = expect(request).rejects.toMatchObject({ statusCode: 424 })
    try {
      await flushDeadlineWork()
      expect(relayAttachment).toHaveBeenCalledOnce()
      const signal = vi.mocked(relayAttachment).mock.calls[0][0].signal!
      await vi.advanceTimersByTimeAsync(75000)
      await rejected
      expect(signal.aborted).toBe(true)
      expect(settleRelay).toHaveBeenCalledExactlyOnceWith(expect.anything(), "lease", 20 * 1024 * 1024, true)
      pending.resolve(new Response(new ReadableStream({ cancel })))
      await flushDeadlineWork()
      expect(cancel).toHaveBeenCalledOnce()
      expect(backupAttachment).not.toHaveBeenCalled()
      expect(settleRelay).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
