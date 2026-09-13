import { describe, expect, it, vi } from "vitest"
import { attachmentCacheKey, cacheAttachment, cachedAttachment, privateAttachmentResponse } from "../server/utils/attachment-cache"
import { attachmentPreviewPolicy } from "../shared/attachment-preview"
import { asArrayBuffer, makeFixtures } from "../scripts/attachment-preview-fixtures.mjs"

const fixture = makeFixtures().docx
const headers = new Headers({ "Content-Type": fixture.mime, "Content-Disposition": "inline; filename=test.docx", "Set-Cookie": "never-copy" })
const key = new Request("https://news.example.com/__attachment-cache/test")
describe("short-lived attachment cache", () => {
  it("stores only valid bounded bytes and enforces TTL even if the cache returns stale data", async () => {
    let saved: Response | undefined
    const cache = { put: vi.fn(async (_key: Request, value: Response) => {
      saved = value
    }), match: vi.fn(async () => saved?.clone()) }
    await cacheAttachment(cache, key, asArrayBuffer(fixture.bytes), headers, 1000)
    expect(cache.put).toHaveBeenCalledOnce()
    expect(saved?.headers.get("set-cookie")).toBeNull()
    expect(saved?.headers.get("cache-control")).toBe("public, max-age=300")
    const hit = await cachedAttachment(cache, key, 1001)
    expect(await hit?.arrayBuffer()).toEqual(asArrayBuffer(fixture.bytes))
    expect(await cachedAttachment(cache, key, 301000)).toBeUndefined()
  })
  it("never caches login HTML, damaged ZIPs or oversized bytes", async () => {
    const cache = { put: vi.fn(), match: vi.fn() }
    for (const bytes of [new TextEncoder().encode("<html>login</html>"), new Uint8Array([80, 75, 3, 4]), new Uint8Array(attachmentPreviewPolicy.maxCacheBytes + 1)]) {
      await cacheAttachment(cache, key, asArrayBuffer(bytes), headers)
    }
    expect(cache.put).not.toHaveBeenCalled()
  })
  it("treats cache service failure as a miss and strips caching headers from client responses", async () => {
    const cache = { match: vi.fn(async () => {
      throw new Error("unavailable")
    }), put: vi.fn(async () => {
      throw new Error("full")
    }) }
    expect(await cachedAttachment(cache, key)).toBeUndefined()
    await expect(cacheAttachment(cache, key, asArrayBuffer(fixture.bytes), headers)).resolves.toBeUndefined()
    const response = privateAttachmentResponse(asArrayBuffer(fixture.bytes), headers, "cache")
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("x-attachment-via")).toBe("cache")
  })
  it("separates articles and URLs without exposing source URLs in cache keys", async () => {
    const first = await attachmentCacheKey("https://news.example.com", "a", "https://demo.gov.cn/file?id=1")
    expect(first.url).not.toContain("gov.cn")
    expect((await attachmentCacheKey("https://news.example.com", "b", "https://demo.gov.cn/file?id=1")).url).not.toBe(first.url)
    expect((await attachmentCacheKey("https://news.example.com", "a", "https://demo.gov.cn/file?id=2")).url).not.toBe(first.url)
  })
})
