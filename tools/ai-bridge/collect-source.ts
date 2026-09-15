import "./custom-source-http"
import { hackernewsFeed } from "../../server/utils/hackernews-feed"
import type { IntelligenceSource } from "../../shared/intelligence"
import { intelligenceCanonicalUrl, intelligenceDate } from "../../shared/intelligence"
import { type OfficialCandidate, intelligenceDiscoverColumns, intelligenceFetchHtml, intelligenceParseList } from "../../server/utils/intelligence-parser"
import { intelligenceFetchList } from "../../server/utils/intelligence-dynamic-list"
import { resolvePublishedSource } from "./source-config-client"
import { publicationFromHtml } from "./publication-date"
import { getCachedDetail, setCachedDetail } from "./detail-html-cache"

export interface CollectSourceOptions {
  maxPages?: number | null
  shouldContinuePage?: (items: OfficialCandidate[], pageNumber: number) => boolean | Promise<boolean>
}

async function populateOfficialMissingDates(
  source: IntelligenceSource,
  columnName: string,
  items: OfficialCandidate[],
  attempted: Set<string>,
  deadline: number,
  columnErrors: string[],
  columnMissingDates: number[],
): Promise<void> {
  // Only official MOHURD approved columns need detail date resolution when missing from list
  if (source.id !== "official-mohurd" || source.newsnowId) return
  for (const item of items) {
    if (Number.isFinite(item.publishedAt) && item.publishedAt! > 0) continue
    const canonical = intelligenceCanonicalUrl(item.url) || item.url
    if (attempted.has(canonical)) continue
    attempted.add(canonical)

    if (Date.now() >= deadline) {
      columnErrors.push(`${columnName}：采集时间预算耗尽，停止请求详情日期`)
      columnMissingDates[0]++
      break
    }

    try {
      let html: string
      let pageUrl: string
      const cached = getCachedDetail(source.id, item.url)
      if (cached) {
        html = cached.html
        pageUrl = cached.url
      } else {
        const page = await intelligenceFetchHtml(item.url, source)
        html = page.html
        pageUrl = page.url
        setCachedDetail(source.id, item.url, { html, url: pageUrl })
      }
      const officialDate = publicationFromHtml(html, pageUrl)
      if (officialDate) {
        item.publishedAt = officialDate
        const c = getCachedDetail(source.id, item.url)
        if (c) c.publishedAt = officialDate
      } else {
        columnMissingDates[0]++
      }
    } catch (err: any) {
      columnErrors.push(`${columnName}：详情时间获取失败（${item.title.slice(0, 20)}...: ${err.message}）`)
      columnMissingDates[0]++
    }
  }
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
  const attempted = new Set<string>()

  for (const column of columns.slice(0, collectionMode === "explicit" ? 12 : 4)) {
    try {
      const deadline = Date.now() + 120000
      const columnErrors: string[] = []
      const columnMissingDates = [0]

      const page = await intelligenceFetchList(column.url, source, column, {
        maxPages: options.maxPages,
        shouldContinue: async (items, pageNumber) => {
          if (options.maxPages === null && Date.now() >= deadline) throw new Error("本栏目采集超时，已保留读到的文章；日期范围尚未采集完整")
          await populateOfficialMissingDates(source, column.name, items, attempted, deadline, columnErrors, columnMissingDates)
          return options.shouldContinuePage ? options.shouldContinuePage(items, pageNumber) : true
        },
      })

      if (Date.now() < deadline) {
        await populateOfficialMissingDates(source, column.name, page.items, attempted, deadline, columnErrors, columnMissingDates)
      } else {
        columnErrors.push(`${column.name}：采集时间预算耗尽，跳过最终详情时间补全`)
      }

      if (columnMissingDates[0] > 0) {
        warnings.push(`${column.name}：共 ${columnMissingDates[0]} 篇未取得官方有效发布日期，如实保留缺口`)
      }
      if (columnErrors.length) {
        warnings.push(...columnErrors)
      }

      const parsed = page.items
      if (!parsed.length) warnings.push(`${column.name}：栏目未解析到文章`)
      if ("paginationStalled" in page && page.paginationStalled) warnings.push(`${column.name}：分页返回了重复列表，已停止继续请求`)
      if ("paginationError" in page && page.paginationError) warnings.push(`${column.name}：分页未完成：${page.paginationError}；已保留本次读到的标题`)
      if ("paginationUnverified" in page && page.paginationUnverified) warnings.push(`${column.name}：未识别可验证的下一页入口，需核对是否末页或专用分页格式`)
      if (page.capped) warnings.push(`${column.name}：已读取 ${page.pages} 页，仍有未处理内容；达到安全请求上限，本次分页未完成`)
      items.push(...parsed)
    } catch (error: any) {
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
  return { columns, warnings, items: [...new Map(items.map(item => [JSON.stringify([intelligenceCanonicalUrl(item.url), item.title]), item])).values()] }
}

export async function collectSource(source: IntelligenceSource, options: CollectSourceOptions = {}) {
  try {
    const configured = await resolvePublishedSource(source)
    if (configured.enabled === false) return { columns: [], warnings: ["来源已由发布配置停用"], items: [] }
    return await collect(configured, options)
  } catch (error: any) {
    const code = error.cause?.code ?? error.code
    if (code === "ENOTFOUND") throw new Error("来源域名无法解析，需要核对官网地址")
    if (String(code).startsWith("ERR_TLS") || String(code).startsWith("ERR_SSL")) throw new Error(`官网安全连接失败（${code}），未降低证书或加密校验`)
    throw error
  }
}
