import * as cheerio from "cheerio"
import { intelligenceCanonicalUrl, intelligenceDate, intelligenceHttpUrl, type IntelligenceSource } from "@shared/intelligence"

export interface OfficialCandidate {
  title: string
  url: string
  column: string
  publishedAt?: number
  text?: string
  publisher?: string
  documentNo?: string
  attachments: { title: string, url: string }[]
}

const mojibakeTokens = /[鍏鐨鍚涓缁鏂寤璁鏀鍩骞浣浠鍙鍦鎴垮眿锛銆鈥绉瀹璇闃鏃瀛鍙戞湁鏍煎叕鍛婃剰瑙佹爣鍑嗘湇鍔￠」]/g

/**
 * Detect the characteristic output produced when UTF-8 Chinese bytes are
 * decoded as GBK/GB18030. One rare character is not enough to reject text;
 * the guard only fires for replacement characters or a dense suspicious run.
 */
export function intelligenceLooksGarbled(value: string) {
  const compact = value.replace(/\s+/g, "")
  if (!compact) return false
  if (compact.includes("�")) return true
  const suspicious = compact.match(mojibakeTokens)?.length ?? 0
  const length = [...compact].length
  return suspicious >= 3 && suspicious / Math.max(1, length) >= 0.08
}

function replacementCount(value: string) {
  return value.match(/�/g)?.length ?? 0
}

function decodeHtmlBytes(bytes: Uint8Array, contentType: string) {
  // A number of government CMSs publish stale or misleading GBK declarations
  // while the response body is actually UTF-8. Trust the bytes first: valid
  // UTF-8 must win even when a header/meta tag mentions GBK/GB2312.
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    const prefix = new TextDecoder("latin1").decode(bytes.slice(0, 8192))
    const declaredGb = /(?:charset\s*=\s*["']?\s*(?:gb2312|gbk|gb18030)|(?:gb2312|gbk|gb18030))/i.test(`${contentType} ${prefix}`)
    const looseUtf8 = new TextDecoder("utf-8").decode(bytes)
    const gb18030 = new TextDecoder("gb18030").decode(bytes)
    if (declaredGb) return gb18030
    return replacementCount(gb18030) < replacementCount(looseUtf8) ? gb18030 : looseUtf8
  }
}

export function intelligenceAllowedUrl(value: string, source: IntelligenceSource, base = source.home) {
  try {
    const url = new URL(value, base)
    const approved = new URL(source.home)
    const host = (s: string) => s.toLowerCase().replace(/^www\./, "")
    if (!intelligenceHttpUrl(url.href) || host(url.hostname) !== host(approved.hostname) || (url.port && !["80", "443"].includes(url.port))) return
    return url.href
  } catch { return }
}
export async function intelligenceFetchHtml(url: string, source: IntelligenceSource) {
  let current = intelligenceAllowedUrl(url, source)
  if (!current) throw new Error("来源地址未通过白名单校验")
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetch(current, {
      redirect: "manual", signal: AbortSignal.timeout(12000),
      headers: { "User-Agent": "CapxIntelligence/1.0 (official public information reader)", "Accept": "text/html,application/xhtml+xml" },
    })
    if (response.status >= 300 && response.status < 400) {
      const next = intelligenceAllowedUrl(response.headers.get("location") ?? "", source, current)
      await response.body?.cancel()
      if (!next || next === current) throw new Error("官网跳转到未配置的地址，需要更新来源配置")
      current = next
      continue
    }
    if (!response.ok) throw new Error(`官网返回 HTTP ${response.status}`)
    const type = response.headers.get("content-type") ?? ""
    if (type && !/html|xml|text/i.test(type)) { await response.body?.cancel(); throw new Error("来源没有返回可解析的网页") }
    const reader = response.body?.getReader()
    if (!reader) throw new Error("官网响应为空")
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > 2_000_000) { await reader.cancel(); throw new Error("官网页面超过采集大小上限") }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const bytes = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    const html = decodeHtmlBytes(bytes, type)
    if (/验证码|安全验证|访问过于频繁|checking your browser|just a moment/i.test(html.slice(0, 12000)) && html.length < 30000) throw new Error("官网要求访问验证，未绕过验证")
    return { html, url: current }
  }
  throw new Error("官网重定向次数过多")
}
function loadPage(html: string) {
  // Some government CMS pages embed static lists in XML CDATA/comments. Never execute scripts.
  const extra = [...html.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map(m => m[1]).join("\n")
  return cheerio.load(`${html}\n${extra}`.replace(/<!--([\s\S]*?)-->/g, (_match, text: string) => /<a\s/i.test(text) ? text : ""))
}
export function intelligenceDiscoverColumns(html: string, source: IntelligenceSource, base = source.home) {
  const $ = loadPage(html)
  const found = [...(source.columns ?? [])]
  $("a[href]").each((_index, el) => {
    const name = $(el).text().replace(/\s+/g, "").trim()
    if (!/^(通知公告|通知公示|公告公示|公示公告|政策文件|规范性文件|主动公开文件|政策解读|工作动态|建设新闻|建设要闻|行业动态|标准定额|标准规范|最新文件|厅发文件|部门文件)$/.test(name)) return
    const url = intelligenceAllowedUrl($(el).attr("href") ?? "", source, base)
    if (url && !found.some(c => c.url === url)) found.push({ name, url })
  })
  return found.slice(0, 4)
}
export function intelligenceParseList(html: string, source: IntelligenceSource, column: { name: string, url: string }): OfficialCandidate[] {
  const $ = loadPage(html)
  const found = new Map<string, OfficialCandidate>()
  $("a[href]").each((_index, el) => {
    const a = $(el)
    const title = (a.attr("title") || a.text()).replace(/\s+/g, " ").trim()
    const url = intelligenceAllowedUrl(a.attr("href") ?? "", source, column.url)
    if (!url || title.length < 9 || title.length > 240 || intelligenceLooksGarbled(title) || /^(首页|更多|网站地图|联系我们|返回|下一页|上一页)/.test(title)) return
    const path = new URL(url).pathname
    const datedArticleIndex = /\/\d{14,22}\/index\.shtml$/i.test(path)
    if (/\.(pdf|docx?|xlsx?|zip|jpe?g|png|gif)$/i.test(path) || (!datedArticleIndex && /(?:^|\/)(?:index(?:_\d+)?|list)\.[sj]?html?$/i.test(path))) return
    if (!/\.(?:[sj]?html?|htm)$|\/art\/|\/content\/|post_|\/t\d|\/c\d|content-\d/i.test(path)) return
    if (url === column.url || url === source.home) return
    let context = a.closest("li,tr").text() || a.parent().text()
    if (context.length > 800) context = ""
    let publishedAt = intelligenceDate(context)
    // Explicit two-digit years on list rows (e.g. Shenzhen 26-09-03); never guess a year from MM-DD.
    if (!publishedAt) {
      const short = context.match(/(?:^|\s)(2\d)-(\d{2})-(\d{2})(?:\s|$)/)
      if (short) publishedAt = intelligenceDate(`20${short[1]}-${short[2]}-${short[3]}`)
    }
    const key = intelligenceCanonicalUrl(url)
    if (!found.has(key)) found.set(key, { title, url, column: column.name, publishedAt, attachments: [] })
  })
  return [...found.values()].slice(0, 60)
}
export function intelligenceParseArticle(html: string, candidate: OfficialCandidate, source: IntelligenceSource): OfficialCandidate {
  const $ = loadPage(html)
  const meta = (names: string[]) => {
    for (const name of names) {
      const value = $(`meta[name="${name}"],meta[property="${name}"]`).attr("content")?.trim()
      if (value) return value
    }
    return ""
  }
  const fullTitle = meta(["ArticleTitle", "og:title"]) || $("h1").first().text().trim()
  $("script,style,nav,header,footer,form,iframe,noscript").remove()
  let text = ""
  let articleRoot: ReturnType<typeof $> | undefined
  for (const selector of ["#UCAP-CONTENT", ".TRS_Editor", "#zoom", "#zoomcon", ".article-content", ".article_content", ".view.TRS_UEDITOR", ".Custom_UnionStyle", ".content-detail", "article", ".news_content", "#contentText"]) {
    const root = $(selector).first()
    const value = root.text().replace(/\s+/g, " ").trim()
    if (value.length >= 80 && value.length <= 100000) { text = value.slice(0, 8000); articleRoot = root; break }
  }
  // Do not treat the entire site navigation as article text when a template is unknown.
  const attachments = (articleRoot ?? $("body")).find("a[href]").toArray().flatMap(el => {
    const url = intelligenceAllowedUrl($(el).attr("href") ?? "", source, candidate.url)
    if (!url || !/\.(pdf|docx?|xlsx?|zip)(?:\?|$)/i.test(url)) return []
    const rawTitle = $(el).text().trim().slice(0, 160)
    return [{ title: rawTitle && !intelligenceLooksGarbled(rawTitle) ? rawTitle : "原文附件", url }]
  }).slice(0, 16)
  const visible = $("body").text().replace(/\s+/g, " ").slice(0, 5000)
  const dateText = meta(["PubDate", "pubdate", "publishdate", "PublishDate", "article:published_time", "DC.date.issued"])
    || visible.match(/(?:发布时间|发布日期|发布日|时间)\s*[:：]?\s*((?:19|20)\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2})/)?.[1]
  const documentNo = text.match(/[\u4E00-\u9FFF]{1,14}[〔\[]\d{4}[〕\]]\s*\d{1,6}\s*号/)?.[0]
  const publisher = meta(["ContentSource", "source", "Source"]).slice(0, 100)
  return {
    ...candidate, title: fullTitle.length >= 9 && fullTitle.length <= 240 && !intelligenceLooksGarbled(fullTitle) ? fullTitle : candidate.title,
    text: text && !intelligenceLooksGarbled(text.slice(0, 500)) ? text : undefined,
    publishedAt: intelligenceDate(dateText) ?? candidate.publishedAt,
    publisher: publisher && !intelligenceLooksGarbled(publisher) ? publisher : undefined,
    documentNo, attachments,
  }
}
