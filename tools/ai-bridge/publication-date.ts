import * as cheerio from "cheerio"
import type { IntelligenceArticle, IntelligenceSource } from "../../shared/intelligence"
import { intelligenceCanonicalUrl, intelligenceDate, intelligenceHttpUrl } from "../../shared/intelligence"
import { intelligenceFetchHtml } from "../../server/utils/intelligence-parser"

/** Only explicit publication fields; never dateModified, crawledAt, or a headline date. */
export function publicationTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string") return
  const date = intelligenceDate(value)
  if (!date) return
  const time = value.trim().match(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2})[T ](\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?$/)
  if (!time) return date
  const parsed = Date.parse(`${new Date(date + 8 * 3600000).toISOString().slice(0, 10)}T${time[2].split(":").map(part => part.padStart(2, "0")).join(":")}${time[3] || "+08:00"}`)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * X documents Snowflake creation timestamps; BigInt avoids 64-bit ID precision loss.
 * https://docs.x.com/fundamentals/x-ids
 * https://github.com/twitter-archive/snowflake/blob/snowflake-2010/src/main/scala/com/twitter/service/snowflake/IdWorker.scala
 */
export function xPublicationTime(url: URL, now = Date.now()): number | undefined {
  if (!["x.com", "www.x.com", "twitter.com", "www.twitter.com"].includes(url.hostname)) return
  const id = url.pathname.match(/^\/[^/]+\/status\/(\d{16,19})(?:\/|$)/)?.[1]
  if (!id || BigInt(id) > 9223372036854775807n) return
  const time = Number((BigInt(id) >> 22n) + 1288834974657n)
  return time > 1288915200000 && time <= now ? time : undefined
}

export function publicationFromHtml(html: string, url: string): number | undefined {
  const $ = cheerio.load(html)
  const names = new Set(["pubdate", "publishdate", "article:published_time", "dc.date.issued", "datepublished"])
  for (const node of $("meta[content]").toArray()) {
    const name = ($(node).attr("name") || $(node).attr("property") || "").toLowerCase()
    if (names.has(name)) {
      const date = publicationTimestamp($(node).attr("content"))
      if (date) return date
    }
  }
  const host = new URL(url).hostname
  if (host === "www.cls.cn") {
    try {
      const data = JSON.parse($("#__NEXT_DATA__").text()).props.pageProps.articleDetail
      if (String(data.id) === new URL(url).pathname.split("/").pop() && Number.isFinite(data.ctime) && data.ctime > 0) return data.ctime * 1000
    } catch { /* No matching article state. */ }
  }
  if (host === "wallstreetcn.com") {
    for (const script of $("script").toArray()) {
      const raw = $(script).text().trim()
      const value = raw.startsWith("__SSR__") && raw.includes("=") ? raw.slice(raw.indexOf("=") + 1).trim().replace(/;$/, "") : undefined
      if (!value) continue
      try {
        const data = JSON.parse(value).state.default.children.default.data.article
        if (String(data.id) === new URL(url).pathname.split("/").pop() && Number.isFinite(data.display_time) && data.display_time > 0) return data.display_time * 1000
      } catch { /* Parse JSON only; never execute page scripts. */ }
    }
  }
  const dates: number[] = []
  const visit = (value: any) => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    if (!value || typeof value !== "object") return
    const type = [].concat(value["@type"] || []).join(" ")
    const ownUrl = value.url || value.mainEntityOfPage?.["@id"]
    if (/^(?:NewsArticle|Article|BlogPosting|VideoObject|SocialMediaPosting)$/.test(type)
      && (!ownUrl || (typeof ownUrl === "string" && intelligenceCanonicalUrl(ownUrl) === intelligenceCanonicalUrl(url)))) {
      const date = publicationTimestamp(value.datePublished)
      if (date) dates.push(date)
    }
    if (value["@graph"]) visit(value["@graph"])
  }
  for (const node of $("script[type=\"application/ld+json\"]").toArray()) {
    try {
      visit(JSON.parse($(node).text()))
    } catch { /* Invalid structured data supplies no evidence. */ }
  }
  if (new Set(dates).size === 1) return dates[0]
  // IT之家 exposes the original article time in this dedicated element.
  if (new URL(url).hostname === "www.ithome.com") return publicationTimestamp($("#pubtime_baidu, #pubtime").first().text().trim())
}

export async function verifyPublicationDate(source: IntelligenceSource, item: { url: string, publishedAt?: number }, freshOfficialList = false): Promise<Pick<IntelligenceArticle, "publishedAt" | "publicationDate">> {
  const checkedAt = Date.now()
  const proof = (publishedAt: number, basis: "article" | "source_api" | "source_list" | "source_id", url = item.url) => ({ publishedAt, publicationDate: { status: "verified" as const, basis, url, checkedAt } })
  const unknown = (reason: "not_article" | "unavailable" | "not_provided") => ({ publishedAt: undefined, publicationDate: { status: "unknown" as const, url: item.url, checkedAt, reason } })
  const safe = intelligenceHttpUrl(item.url)
  if (!safe) return unknown("unavailable")
  const url = new URL(safe)
  const encodedTime = xPublicationTime(url, checkedAt)
  if (encodedTime) return proof(encodedTime, "source_id")
  if (source.newsnowId === "github-trending-today" || /^(?:www\.baidu\.com|s\.weibo\.com|tieba\.baidu\.com)$/.test(url.hostname) || url.pathname.startsWith("/trending/")) return unknown("not_article")
  try {
    if (source.newsnowId === "hackernews" && url.hostname === "news.ycombinator.com") {
      const id = url.searchParams.get("id")
      if (!id || !/^\d+$/.test(id)) return unknown("not_article")
      const endpoint = `https://hacker-news.firebaseio.com/v0/item/${id}.json`
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(12000) })
      if (!response.ok) return unknown("unavailable")
      const data: any = await response.json()
      if (data.id === Number(id) && data.type === "story" && Number.isFinite(data.time) && data.time > 0) return proof(data.time * 1000, "source_api", endpoint)
      return unknown("not_provided")
    }
    // Public article URLs only. The existing reader rejects cross-host redirects.
    if (!url.hostname.includes(".") || /^[\d.]+$/.test(url.hostname) || /[:[\]]|(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname)) return unknown("unavailable")
    const allowed = source.newsnowId ? { ...source, home: url.origin } : source
    const page = await intelligenceFetchHtml(item.url, allowed)
    const date = publicationFromHtml(page.html, page.url)
    if (date) return proof(date, "article", page.url)
  } catch {
    if (!freshOfficialList || source.newsnowId || !Number.isFinite(item.publishedAt)) return unknown("unavailable")
  }
  // Only a freshly parsed, article-scoped official list may provide fallback evidence.
  if (freshOfficialList && !source.newsnowId && Number.isFinite(item.publishedAt) && item.publishedAt! > 0) return proof(item.publishedAt!, "source_list")
  return unknown("not_provided")
}
