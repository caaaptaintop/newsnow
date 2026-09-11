import { hackernewsFeed } from "../../server/utils/hackernews-feed"
import type { IntelligenceSource } from "../../shared/intelligence"
import { intelligenceCanonicalUrl, intelligenceDate } from "../../shared/intelligence"
import { intelligenceDiscoverColumns, intelligenceFetchHtml, intelligenceParseList, type OfficialCandidate } from "../../server/utils/intelligence-parser"
import { intelligenceFetchList } from "../../server/utils/intelligence-dynamic-list"
import { resolvePublishedSource } from "./source-config-client"

export interface CollectSourceOptions {
  maxPages?: number
  shouldContinuePage?: (items: OfficialCandidate[], pageNumber: number) => boolean | Promise<boolean>
}

/** An unreadable column must not become an empty success. */
async function collect(source: IntelligenceSource & { collectionMode?: string }, options: CollectSourceOptions) {
  const warnings: string[] = []
  if (source.newsnowId === "hackernews") {
    const items = await hackernewsFeed()
    return {
      columns: [{ name: "Hacker News 官方 API", url: "https://github.com/HackerNews/API" }],
      warnings,
      items: items.map(item => ({ title: item.title, url: item.url, column: "热点与快讯", publishedAt: intelligenceDate(item.pubDate) })),
    }
  }
  if (source.newsnowId) {
    const response = await fetch(`https://news.capx-ai.com/api/s?id=${encodeURIComponent(source.newsnowId)}&limit=30`, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`热榜读取失败（HTTP ${response.status}）`)
    const feed: any = await response.json()
    if (!Array.isArray(feed.items) || !feed.items.length) throw new Error("未返回新闻，不能视为采集成功")
    return {
      columns: [{ name: "热点与快讯", url: source.home }],
      warnings,
      items: feed.items.map((item: any) => ({ title: item.title, url: item.url, column: "热点与快讯", publishedAt: intelligenceDate(item.pubDate) })),
    }
  }
  const collectionMode = source.collectionMode
  let homepage
  let columns = source.columns ?? []
  if (collectionMode === "explicit" && !columns.length) throw new Error("明确栏目模式没有启用栏目")
  if (!columns.length) {
    homepage = await intelligenceFetchHtml(source.home, source)
    columns = intelligenceDiscoverColumns(homepage.html, source, homepage.url)
  }
  const items: any[] = []
  for (const column of columns.slice(0, collectionMode === "explicit" ? 12 : 4)) {
    try {
      const page = await intelligenceFetchList(column.url, source, column, {
        maxPages: options.maxPages,
        shouldContinue: options.shouldContinuePage,
      })
      const parsed = page.items
      if (!parsed.length) warnings.push(`${column.name}：栏目未解析到文章`)
      if (page.paginationStalled) warnings.push(`${column.name}：分页返回了重复列表，已停止继续请求`)
      if (page.capped) warnings.push(`${column.name}：连续发现尚未处理的相关内容，已读取 ${page.pages} 页并达到单轮分页上限`)
      items.push(...parsed)
    }
    catch (error: any) {
      warnings.push(`${column.name}：${error.message}`)
    }
  }
  if (!items.length && collectionMode !== "explicit") {
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

export async function collectSource(source: IntelligenceSource, options: CollectSourceOptions = {}) {
  try {
    const configured = await resolvePublishedSource(source)
    if (configured.enabled === false) return { columns: [], warnings: ["来源已由发布配置停用"], items: [] }
    return await collect(configured, options)
  }
  catch (error: any) {
    const code = error.cause?.code ?? error.code
    if (code === "ENOTFOUND") throw new Error("来源域名无法解析，需要核对官网地址")
    if (String(code).startsWith("ERR_TLS") || String(code).startsWith("ERR_SSL")) throw new Error(`官网安全连接失败（${code}），未降低证书或加密校验`)
    throw error
  }
}
