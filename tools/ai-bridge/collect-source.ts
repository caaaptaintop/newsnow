import { hackernewsFeed } from "../../server/utils/hackernews-feed"
import type { IntelligenceSource } from "../../shared/intelligence"
import { intelligenceCanonicalUrl, intelligenceDate } from "../../shared/intelligence"
import { intelligenceDiscoverColumns, intelligenceFetchHtml, intelligenceParseList } from "../../server/utils/intelligence-parser"

/** An unreadable column must not become an empty success. */
async function collect(source: IntelligenceSource) {
  const warnings: string[] = []
  if (source.newsnowId === "hackernews") {
    const items = await hackernewsFeed()
    return { columns: [{ name: "Hacker News 官方 API", url: "https://github.com/HackerNews/API" }], warnings, items: items.map(item => ({ title: item.title, url: item.url, column: "热点与快讯", publishedAt: intelligenceDate(item.pubDate) })) }
  }
  if (source.newsnowId) {
    const response = await fetch(`https://news.capx-ai.com/api/s?id=${encodeURIComponent(source.newsnowId)}&limit=30`, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`热榜读取失败（HTTP ${response.status}）`)
    const feed: any = await response.json()
    if (!Array.isArray(feed.items) || !feed.items.length) throw new Error("未返回新闻，不能视为采集成功")
    return { columns: [{ name: "热点与快讯", url: source.home }], warnings, items: feed.items.map((item: any) => ({ title: item.title, url: item.url, column: "热点与快讯", publishedAt: intelligenceDate(item.pubDate) })) }
  }
  let homepage
  let columns = source.columns ?? []
  if (!columns.length) {
    homepage = await intelligenceFetchHtml(source.home, source)
    columns = intelligenceDiscoverColumns(homepage.html, source, homepage.url)
  }
  const items: any[] = []
  for (const column of columns.slice(0, 4)) {
    try {
      const page = await intelligenceFetchHtml(column.url, source)
      const parsed = intelligenceParseList(page.html, source, { ...column, url: page.url })
      if (!parsed.length) warnings.push(`${column.name}：栏目未解析到文章`)
      items.push(...parsed)
    } catch (error: any) {
      warnings.push(`${column.name}：${error.message}`)
    }
  }
  if (!items.length) {
    homepage ??= await intelligenceFetchHtml(source.home, source)
    const column = { name: "官网首页公开文章", url: homepage.url }
    const parsed = intelligenceParseList(homepage.html, source, column)
    if (parsed.length) {
      items.push(...parsed)
      columns = [...columns, column]
      warnings.push("专门栏目尚未完整适配，本轮仅读取首页公开文章")
    }
  }
  if (!items.length) throw new Error(warnings.join("；") || "未解析到文章，需要专用栏目适配")
  return { columns, warnings, items: [...new Map(items.map(item => [intelligenceCanonicalUrl(item.url), item])).values()] }
}

export async function collectSource(source: IntelligenceSource) {
  try {
    return await collect(source)
  } catch (error: any) {
    const code = error.cause?.code ?? error.code
    if (code === "ENOTFOUND") throw new Error("来源域名无法解析，需要核对官网地址")
    if (String(code).startsWith("ERR_TLS") || String(code).startsWith("ERR_SSL")) throw new Error(`官网安全连接失败（${code}），未降低证书或加密校验`)
    throw error
  }
}
