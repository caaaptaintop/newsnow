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
const attachmentExtensions = new Set(["pdf", "ofd", "doc", "docx", "docm", "wps", "rtf", "xls", "xlsx", "xlsm", "xlsb", "csv", "ppt", "pptx", "pptm", "zip", "rar", "7z", "txt"])
export const intelligenceAttachmentDiscoveryVersion = 2

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

function attachmentExtension(...values: Array<string | undefined>) {
  for (const value of values) {
    if (!value) continue
    let decoded = value
    try { decoded = decodeURIComponent(value) } catch { /* Keep the original encoded value. */ }
    const matches = decoded.toLowerCase().matchAll(/\.([a-z0-9]{1,6})(?=$|[?#&=;,\s)）\]}>])/g)
    for (const match of matches) if (attachmentExtensions.has(match[1])) return match[1]
  }
}
function governmentScope(hostname: string) {
  const host = hostname.toLowerCase().replace(/^www\./, "")
  if (!host.endsWith(".gov.cn")) return host
  const parts = host.split(".")
  return parts.length >= 3 ? parts.slice(-3).join(".") : host
}
/**
 * Attachment links are displayed, never fetched. Keep the normal same-host
 * rule, while allowing file subdomains inside the same Chinese government
 * site scope (for example zfcxjst.yn.gov.cn -> files.yn.gov.cn).
 */
export function intelligenceAllowedAttachmentUrl(value: string, source: IntelligenceSource, base = source.home) {
  try {
    const url = new URL(value, base)
    const safe = intelligenceHttpUrl(url.href)
    if (!safe || (url.port && !["80", "443"].includes(url.port))) return
    const approved = new URL(source.home)
    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    const approvedHost = approved.hostname.toLowerCase().replace(/^www\./, "")
    if (host === approvedHost) return safe
    if (host.endsWith(".gov.cn") && approvedHost.endsWith(".gov.cn") && governmentScope(host) === governmentScope(approvedHost)) return safe
  } catch { return }
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
function decodeStaticJsString(value: string) {
  return value.replace(/\\(?:u\{([0-9a-f]{1,6})\}|u([0-9a-f]{4})|x([0-9a-f]{2})|([\\'"nrtbfv0]))/gi, (_match, brace: string, unicode: string, hex: string, simple: string) => {
    const code = brace || unicode || hex
    if (code) {
      const value = Number.parseInt(code, 16)
      return Number.isFinite(value) && value <= 0x10FFFF ? String.fromCodePoint(value) : ""
    }
    return ({ "\\": "\\", "'": "'", '"': '"', n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" } as Record<string, string>)[simple] ?? simple
  })
}

function staticDocumentWriteHtml(html: string) {
  // TRS-style government CMS templates can keep attachment anchors either in
  // document.write('...') itself or in a static variable such as hasFJ that is
  // later written to the page. Read string literals only; never evaluate JS.
  const fragments: string[] = []
  let total = 0
  for (const scriptMatch of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const script = scriptMatch[1]
    if (script.length > 200_000 || !/document\.write(?:ln)?\s*\(/i.test(script)) continue
    for (const pattern of [/'((?:\\.|[^'\\])*)'/g, /"((?:\\.|[^"\\])*)"/g]) {
      for (const match of script.matchAll(pattern)) {
        if (match[1].length > 80_000) continue
        const decoded = decodeStaticJsString(match[1])
        if (!/<a\b/i.test(decoded)) continue
        // attachmentExtension is designed for URLs/titles; normalize the JS
        // quote boundary before using it as a coarse prefilter. Every actual
        // href is still resolved and checked by intelligenceAllowedAttachmentUrl.
        const fileish = attachmentExtension(decoded.replace(/["']/g, " "))
        const opaque = /<a\b[^>]*href\s*=\s*["'][^"']*(?:download|attachment|file)[^"']*["'][^>]*>[\s\S]{0,240}(?:附件|下载)/i.test(decoded)
        if (!fileish && !opaque) continue
        total += decoded.length
        if (total > 100_000) return fragments.join("\n")
        fragments.push(`<div data-intelligence-static-write>${decoded}</div>`)
      }
    }
  }
  return fragments.join("\n")
}

function loadPage(html: string) {
  // Some government CMS pages embed static lists in XML CDATA/comments or in
  // static JS strings. None of these parsing paths execute page scripts.
  const extra = [...html.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map(m => m[1]).join("\n")
  const staticWritten = staticDocumentWriteHtml(html)
  return cheerio.load(`${html}\n${extra}\n${staticWritten}`.replace(/<!--([\s\S]*?)-->/g, (_match, text: string) => /<a\s/i.test(text) ? text : ""))
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
    if (attachmentExtension(path, url) || (!datedArticleIndex && /(?:^|\/)(?:index(?:_\d+)?|list)\.[sj]?html?$/i.test(path))) return
    if (!/\.(?:[sj]?html?|htm)$|\/art\/|\/content\/|post_|\/t\d|\/c\d|content-\d/i.test(path)) return
    if (url === column.url || url === source.home) return
    // A date inside this link belongs to this article. Never read dates from
    // a shared list container containing links to other articles.
    const row = a.closest("li,tr").length ? a.closest("li,tr") : a.parent()
    const dateText = (scope: ReturnType<typeof $>) => {
      const values = scope.find("time,em,span,[class*=date],[class*=time]").toArray().map(node => $(node).attr("datetime") || $(node).text())
      values.push(...scope.contents().toArray().filter(node => node.type === "text").map(node => $(node).text()))
      return values.map(value => value.trim()).find(value => /^(?:(?:19|20)?\d{2}[-年/.]\d{1,2}[-月/.]\d{1,2}日?)(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(value)) || ""
    }
    const ownContext = dateText(a)
    const singleArticleRow = row.find("a[href]").toArray().every(link => {
      const href = intelligenceAllowedUrl($(link).attr("href") ?? "", source, column.url)
      return href === url
    })
    let context = ownContext || (singleArticleRow ? dateText(row) : "")
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
  const foundAttachments = new Map<string, { title: string, url: string }>()
  const attachmentLinks = [
    ...(articleRoot ?? $("body")).find("a[href]").toArray(),
    ...$("[data-intelligence-static-write] a[href]").toArray(),
  ]
  attachmentLinks.forEach((el) => {
    const href = $(el).attr("href") ?? ""
    const url = intelligenceAllowedAttachmentUrl(href, source, candidate.url)
    if (!url) return
    const rawTitle = $(el).text().replace(/\s+/g, " ").trim().slice(0, 160)
    const download = ($(el).attr("download") ?? "").trim().slice(0, 160)
    const extension = attachmentExtension(url, rawTitle, download)
    let opaqueDownload = !!download
    try {
      const parsed = new URL(url)
      opaqueDownload ||= /附件|下载/i.test(rawTitle) && /(?:download|attachment|file)/i.test(`${parsed.pathname}${parsed.search}`)
    } catch { /* The URL has already passed validation. */ }
    if (!extension && !opaqueDownload) return
    let filename = ""
    try {
      const parsed = new URL(url)
      filename = [...parsed.searchParams.entries()].find(([key, value]) => /(?:file|name|attachment)/i.test(key) && value)?.[1] || parsed.pathname.split("/").pop() || ""
      try { filename = decodeURIComponent(filename) } catch { /* Keep encoded filename. */ }
    } catch { /* The URL has already passed validation. */ }
    const preferredTitle = rawTitle && !intelligenceLooksGarbled(rawTitle) ? rawTitle : download && !intelligenceLooksGarbled(download) ? download : filename && !intelligenceLooksGarbled(filename) ? filename : "原文附件"
    const key = intelligenceCanonicalUrl(url) || url
    if (!foundAttachments.has(key)) foundAttachments.set(key, { title: preferredTitle, url })
  })
  const attachments = [...foundAttachments.values()].slice(0, 16)
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
