import { describe, expect, it, vi } from "vitest"
import { publicationFromHtml, publicationTimestamp, verifyPublicationDate, xPublicationTime } from "../tools/ai-bridge/publication-date"
import { intelligenceSources } from "../shared/official-sources"

describe("source publication evidence", () => {
  it("preserves exact source time and timezone, rejecting impossible dates", () => {
    expect(publicationTimestamp("2026/9/8 19:29:48")).toBe(Date.parse("2026-09-08T19:29:48+08:00"))
    expect(publicationTimestamp("2026-09-08T11:29:48Z")).toBe(Date.parse("2026-09-08T11:29:48Z"))
    expect(publicationTimestamp("2026-02-30")).toBeUndefined()
  })
  it("ignores modification, navigation and headline dates", () => {
    const html = "<meta property=\"article:modified_time\" content=\"2026-09-09\"><h1>2026年8月31日会议</h1><span>发布时间：2026-09-08</span>"
    expect(publicationFromHtml(html, "https://example.org/a")).toBeUndefined()
    expect(publicationFromHtml(`${html}<meta name="PubDate" content="2026-09-02">`, "https://example.org/a")).toBe(publicationTimestamp("2026-09-02"))
  })
  it("requires structured article identity and rejects related articles", () => {
    const html = "<script type=\"application/ld+json\">{\"@type\":\"NewsArticle\",\"url\":\"https://example.org/other\",\"datePublished\":\"2026-09-09\"}</script>"
    expect(publicationFromHtml(html, "https://example.org/a")).toBeUndefined()
  })
  it("uses matching CLS article ctime, not a recommendation timestamp", () => {
    const html = "<script id=\"__NEXT_DATA__\" type=\"application/json\">{\"props\":{\"pageProps\":{\"articleDetail\":{\"id\":123,\"ctime\":1788859509}}}}</script>"
    expect(publicationFromHtml(html, "https://www.cls.cn/detail/123")).toBe(1788859509000)
    expect(publicationFromHtml(html, "https://www.cls.cn/detail/456")).toBeUndefined()
  })
  it("never promotes an old stored date after a failed verification", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline")
    }))
    try {
      const source = intelligenceSources.find(s => s.id === "official-zhengzhou")!
      const item = { url: `${source.home}tzgg/1.jhtml`, publishedAt: Date.now() }
      const failed = await verifyPublicationDate(source, item)
      expect(failed.publishedAt).toBeUndefined()
      expect(failed.publicationDate?.status).toBe("unknown")
      const freshList = await verifyPublicationDate(source, item, true)
      expect(freshList.publicationDate?.basis).toBe("source_list")
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it("classifies search/ranking links as undated without requesting their pages", async () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    try {
      const source = intelligenceSources.find(s => s.newsnowId === "baidu")!
      const result = await verifyPublicationDate(source, { url: "https://www.baidu.com/s?wd=test", publishedAt: Date.now() })
      expect(result.publicationDate?.reason).toBe("not_article")
      expect(result.publishedAt).toBeUndefined()
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

it("reads the exact X Snowflake timestamp without Number rounding or future IDs", () => {
  const time = Date.parse("2026-09-08T03:04:05.678Z")
  const id = ((BigInt(time) - 1288834974657n) << 22n) | 4194303n
  expect(xPublicationTime(new URL(`https://x.com/example/status/${id}`), time + 1)).toBe(time)
  expect(xPublicationTime(new URL(`https://x.com/example/status/${id}`), time - 1)).toBeUndefined()
  expect(xPublicationTime(new URL(`https://example.org/example/status/${id}`), time + 1)).toBeUndefined()
  expect(xPublicationTime(new URL("https://x.com/jack/status/20"))).toBeUndefined()
})
