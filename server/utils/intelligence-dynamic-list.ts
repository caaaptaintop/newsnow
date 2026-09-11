import type { IntelligenceSource } from "../../shared/intelligence"
import { intelligenceCanonicalUrl } from "../../shared/intelligence"
import { intelligenceAllowedUrl, intelligenceFetchHtml, intelligenceParseList, type OfficialCandidate } from "./intelligence-parser"
import { sourceFetchError } from "./source-fetch-diagnostic"

const jpaasUnitPath = "/api-gateway/jpaas-publish-server/front/page/build/unit"
const jpaasPageSize = 20
const jpaasMaxPages = 5
const collectionHeaders = { "User-Agent": "CapxIntelligence/1.0 (official public information reader)" }

export interface IntelligenceFetchListOptions {
  maxPages?: number
  shouldContinue?: (items: OfficialCandidate[], pageNumber: number) => boolean | Promise<boolean>
}

function htmlEntityText(value: string) {
  return value.replace(/&amp;/gi, "&").replace(/&#38;/g, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
}
function parameter(window: string, key: string) {
  const kebab = key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const dataKey = kebab.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const patterns = [
    new RegExp(`["']?${escaped}["']?\\s*[:=]\\s*["']([^"'<>]{1,180})["']`, "i"),
    new RegExp(`data-${dataKey}\\s*=\\s*["']([^"'<>]{1,180})["']`, "i"),
    new RegExp(`${escaped}=([^&"'\\s<>]{1,180})`, "i"),
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(window)
    if (!match) continue
    let value = htmlEntityText(match[1]).trim()
    try { value = decodeURIComponent(value) } catch { /* Keep literal value. */ }
    if (value && value.length <= 180 && !/[\u0000-\u001f<>]/.test(value)) return value
  }
}
/** Extract one coherent JPaas unit request without evaluating site JavaScript. */
export function intelligenceJPaasUnitUrl(html: string, source: IntelligenceSource, base: string) {
  const marker = html.indexOf(jpaasUnitPath)
  if (marker < 0) return
  const windows: Array<{ local: string, broad: string }> = []
  for (const match of html.matchAll(/tagId/gi)) {
    const position = match.index ?? 0
    windows.push({
      local: html.slice(Math.max(0, position - 900), Math.min(html.length, position + 1500)),
      broad: html.slice(Math.max(0, position - 2500), Math.min(html.length, position + 4500)),
    })
    if (windows.length >= 24) break
  }
  windows.push({
    local: html.slice(Math.max(0, marker - 1800), Math.min(html.length, marker + 3200)),
    broad: html.slice(Math.max(0, marker - 6000), Math.min(html.length, marker + 12000)),
  })
  const required = ["parseType", "webId", "tplSetId", "pageType", "tagId", "pageId"] as const
  const candidates = windows.map(({ local, broad }) => {
    const values = Object.fromEntries(required.map(key => [key, parameter(local, key) ?? parameter(broad, key)])) as Record<(typeof required)[number], string | undefined>
    return { window: local, values }
  }).filter(candidate => required.every(key => candidate.values[key]))
    .sort((a, b) => {
      const score = (value: typeof a) => (/list|列表|栏目/i.test(value.values.tagId!) ? 4 : 0)
        + (value.values.pageType === "column" ? 2 : 0) + (value.values.parseType === "bulidstatic" ? 1 : 0)
      return score(b) - score(a)
    })
  const selected = candidates[0]
  if (!selected) return
  const url = new URL(jpaasUnitPath, base)
  for (const key of required) url.searchParams.set(key, selected.values[key]!)
  url.searchParams.set("editType", parameter(selected.window, "editType") ?? "null")
  return intelligenceAllowedUrl(url.href, source, base)
}
function pagedUnitUrl(endpoint: string, source: IntelligenceSource, base: string, pageNumber: number) {
  if (pageNumber === 1) return endpoint
  const url = new URL(endpoint)
  url.searchParams.delete("editType")
  url.searchParams.set("paramJson", JSON.stringify({ pageNo: pageNumber, pageSize: jpaasPageSize }))
  return intelligenceAllowedUrl(url.href, source, base)
}
function nextPageAvailable(fragment: string, pageNumber: number, items: OfficialCandidate[]) {
  const controls = [...fragment.matchAll(/\bdata-page\s*=\s*["']?(\d{1,6})["']?/gi)].map(match => Number(match[1]))
  return controls.length ? controls.includes(pageNumber + 1) : items.length > 0
}
function pageSignature(items: OfficialCandidate[]) {
  return items.map(item => intelligenceCanonicalUrl(item.url)).filter(Boolean).sort().join("\n")
}
async function readBounded(response: Response, maxBytes: number) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("动态栏目接口响应为空")
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) { await reader.cancel(); throw new Error("动态栏目响应超过采集大小上限") }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}
async function dynamicFragment(endpoint: string, pageUrl: string, source: IntelligenceSource, pageNumber: number) {
  const requestUrl = pagedUnitUrl(endpoint, source, pageUrl, pageNumber)
  if (!requestUrl) throw new Error("动态栏目分页地址未通过白名单校验")
  const response = await fetch(requestUrl, {
    redirect: "manual", signal: AbortSignal.timeout(12000),
    headers: { ...collectionHeaders, "Accept": "application/json,text/plain,*/*", "Referer": pageUrl },
  })
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error("动态栏目接口发生跳转，未自动跟随") }
  if (!response.ok) throw await sourceFetchError(response)
  const type = response.headers.get("content-type") ?? ""
  if (type && !/json|text/i.test(type)) { await response.body?.cancel(); throw new Error("动态栏目接口未返回 JSON") }
  let raw: string
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(await readBounded(response, 512_000)) }
  catch (error) { if (error instanceof TypeError) throw new Error("动态栏目接口不是有效 UTF-8"); throw error }
  let payload: unknown
  try { payload = JSON.parse(raw) } catch { throw new Error("动态栏目接口 JSON 无效") }
  const fragment = (payload as { data?: { html?: unknown } })?.data?.html
  if (typeof fragment !== "string" || !fragment.trim() || new TextEncoder().encode(fragment).length > 384_000) throw new Error("动态栏目接口未返回可解析列表")
  if (/验证码|安全验证|访问过于频繁|checking your browser|just a moment/i.test(fragment.slice(0, 12000)) && fragment.length < 30000) throw new Error("动态栏目接口要求访问验证，未绕过验证")
  return fragment
}
function mergeItems(target: Map<string, OfficialCandidate>, items: OfficialCandidate[]) {
  for (const item of items) {
    const key = intelligenceCanonicalUrl(item.url)
    if (key && !target.has(key)) target.set(key, item)
  }
}

/**
 * Fetch one list page. Production collection may continue through a bounded
 * JPaas pagination window only when the caller says the current page still
 * contains unseen relevant records. Admin configuration tests intentionally
 * use the default one-page budget.
 */
export async function intelligenceFetchList(url: string, source: IntelligenceSource, column: { name: string, url: string }, options: IntelligenceFetchListOptions = {}) {
  const page = await intelligenceFetchHtml(url, source)
  let items = intelligenceParseList(page.html, source, { ...column, url: page.url })
  if (items.length) return { ...page, items, dynamic: false, pages: 1, capped: false }
  const endpoint = intelligenceJPaasUnitUrl(page.html, source, page.url)
  if (!endpoint) return { ...page, items, dynamic: false, pages: 1, capped: false }

  const requestedMax = Number.isSafeInteger(options.maxPages) ? Number(options.maxPages) : 1
  const maxPages = Math.max(1, Math.min(jpaasMaxPages, requestedMax))
  let fragment = await dynamicFragment(endpoint, page.url, source, 1)
  items = intelligenceParseList(fragment, source, { ...column, url: page.url })
  const collected = new Map<string, OfficialCandidate>()
  mergeItems(collected, items)
  let pages = 1
  let currentItems = items
  let signature = pageSignature(currentItems)
  let paginationStalled = false
  let nextAvailable = nextPageAvailable(fragment, pages, currentItems)
  let continueWanted = nextAvailable && maxPages > 1
    ? options.shouldContinue ? await options.shouldContinue(currentItems, pages) : true
    : false

  while (nextAvailable && continueWanted && pages < maxPages) {
    const nextPage = pages + 1
    fragment = await dynamicFragment(endpoint, page.url, source, nextPage)
    currentItems = intelligenceParseList(fragment, source, { ...column, url: page.url })
    pages = nextPage
    if (!currentItems.length) { nextAvailable = false; continueWanted = false; break }
    const nextSignature = pageSignature(currentItems)
    if (nextSignature && nextSignature === signature) { paginationStalled = true; nextAvailable = false; continueWanted = false; break }
    signature = nextSignature
    mergeItems(collected, currentItems)
    nextAvailable = nextPageAvailable(fragment, pages, currentItems)
    continueWanted = nextAvailable && (options.shouldContinue ? await options.shouldContinue(currentItems, pages) : true)
  }
  const capped = pages >= maxPages && nextAvailable && continueWanted
  return { ...page, items: [...collected.values()], dynamic: true, pages, capped, paginationStalled }
}
