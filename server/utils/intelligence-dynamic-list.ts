import { load } from "cheerio"
import type { IntelligenceSource } from "../../shared/intelligence"
import { intelligenceCanonicalUrl } from "../../shared/intelligence"
import { sourceHttp } from "./source-http"
import { type OfficialCandidate, intelligenceAllowedUrl, intelligenceFetchHtml, intelligenceParseList } from "./intelligence-parser"
import { sourceFetchError } from "./source-fetch-diagnostic"

const jpaasUnitPath = "/api-gateway/jpaas-publish-server/front/page/build/unit"
const jpaasPageSize = 20
const jpaasMaxPages = 100
const collectionHeaders = { "User-Agent": "CapxIntelligence/1.0 (official public information reader)" }

export interface IntelligenceFetchListOptions {
  maxPages?: number | null
  shouldContinue?: (items: OfficialCandidate[], pageNumber: number) => boolean | Promise<boolean>
}

function htmlEntityText(value: string) {
  return value.replace(/&amp;/gi, "&").replace(/&#38;/g, "&").replace(/&quot;/gi, "\"").replace(/&#39;|&apos;/gi, "'")
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
    try {
      value = decodeURIComponent(value)
    } catch { /* Keep literal value. */ }
    if (value && value.length <= 180 && !/[<>]/.test(value) && ![...value].some(char => char.charCodeAt(0) < 32)) return value
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
  }).filter(candidate => required.every(key => candidate.values[key])).sort((a, b) => {
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
  return controls.length ? controls.some(number => number > pageNumber) : items.length > 0
}
function pageSignature(items: OfficialCandidate[]) {
  return items.map(item => JSON.stringify([intelligenceCanonicalUrl(item.url), item.title])).sort().join("\n")
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
      if (length > maxBytes) {
        await reader.cancel()
        throw new Error("动态栏目响应超过采集大小上限")
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}
async function dynamicFragment(endpoint: string, pageUrl: string, source: IntelligenceSource, pageNumber: number) {
  const requestUrl = pagedUnitUrl(endpoint, source, pageUrl, pageNumber)
  if (!requestUrl) throw new Error("动态栏目分页地址未通过白名单校验")
  const response = await sourceHttp(requestUrl, source, {
    redirect: "manual",
    signal: AbortSignal.timeout(12000),
    headers: { ...collectionHeaders, Accept: "application/json,text/plain,*/*", Referer: pageUrl },
  })
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel()
    throw new Error("动态栏目接口发生跳转，未自动跟随")
  }
  if (!response.ok) throw await sourceFetchError(response)
  const type = response.headers.get("content-type") ?? ""
  if (type && !/json|text/i.test(type)) {
    await response.body?.cancel()
    throw new Error("动态栏目接口未返回 JSON")
  }
  let raw: string
  try {
    raw = new TextDecoder("utf-8", { fatal: true }).decode(await readBounded(response, 512_000))
  } catch (error) {
    if (error instanceof TypeError) throw new Error("动态栏目接口不是有效 UTF-8")
    throw error
  }
  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    throw new Error("动态栏目接口 JSON 无效")
  }
  const fragment = (payload as { data?: { html?: unknown } })?.data?.html
  if (typeof fragment !== "string" || !fragment.trim() || new TextEncoder().encode(fragment).length > 384_000) throw new Error("动态栏目接口未返回可解析列表")
  if (/验证码|安全验证|访问过于频繁|checking your browser|just a moment/i.test(fragment.slice(0, 12000)) && fragment.length < 30000) throw new Error("动态栏目接口要求访问验证，未绕过验证")
  return fragment
}
function mergeItems(target: Map<string, OfficialCandidate>, items: OfficialCandidate[]) {
  for (const item of items) {
    const url = intelligenceCanonicalUrl(item.url)
    const key = JSON.stringify([url, item.title])
    if (url && !target.has(key)) target.set(key, item)
  }
}

function staticNextPages(html: string, source: IntelligenceSource, base: string) {
  const $ = load(html)
  const targets: string[] = []
  for (const anchor of $("a[href],a[tagname],a[onclick]").toArray()) {
    const a = $(anchor)
    const label = a.attr("title")?.trim() || a.text().replace(/\s+/g, "").replace(/[>›»]+$/g, "")
    if (!/\bnext\b/i.test(a.attr("rel") ?? "") && !/^(?:下一页|下页|next|›|»)$/i.test(label)) continue
    const href = a.attr("href")?.trim()
    const tagname = a.attr("tagname")?.trim()
    const onclick = a.attr("onclick") ?? ""
    const scripted = /\bqueryArticleByCondition\s*\(\s*this\s*,\s*(['"])([^'"<>\s]{1,1000})\1/i.exec(onclick)?.[2]
    const raw = href && !/^(?:javascript:|#)/i.test(href) ? href : tagname || scripted
    if (!raw || /^(?:javascript:|#)/i.test(raw)) continue
    const target = intelligenceAllowedUrl(raw, source, base)
    if (target && new URL(target).origin === new URL(base).origin && target !== base && !targets.includes(target)) targets.push(target)
  }
  return targets
}

async function staticPages(page: Awaited<ReturnType<typeof intelligenceFetchHtml>>, initial: OfficialCandidate[], source: IntelligenceSource, column: { name: string, url: string }, options: IntelligenceFetchListOptions) {
  const maxPages = options.maxPages === null ? Number.POSITIVE_INFINITY : Math.max(1, Math.min(jpaasMaxPages, options.maxPages ?? 1))
  const collected = new Map<string, OfficialCandidate>()
  mergeItems(collected, initial)
  const visited = new Set([page.url])
  const queued = new Set<string>()
  const signatures = new Set([pageSignature(initial)])
  let pages = 1
  let attempts = 1
  let paginationError: string | undefined
  const allowNext = async (items: OfficialCandidate[], pageNumber: number) => {
    try {
      return options.shouldContinue ? await options.shouldContinue(items, pageNumber) : true
    } catch (error: any) {
      paginationError = error.message
      return false
    }
  }
  const marker = /createPageHTML|pageCount|queryArticleByCondition|下一页/.test(page.html)
  const firstTargets = staticNextPages(page.html, source, page.url)
  let recognizedPagination = firstTargets.length > 0
  const queue: string[] = []
  if (firstTargets.length && maxPages > 1 && await allowNext(initial, pages)) {
    for (const target of firstTargets) {
      queued.add(target)
      queue.push(target)
    }
  }
  let paginationStalled = false
  while (queue.length && attempts < maxPages) {
    const next = queue.shift()!
    queued.delete(next)
    if (visited.has(next)) continue
    visited.add(next)
    attempts++
    let current
    try {
      current = await intelligenceFetchHtml(next, source)
    } catch (error: any) {
      paginationError ??= error.message
      continue
    }
    const currentItems = intelligenceParseList(current.html, source, { ...column, url: current.url })
    pages++
    if (!currentItems.length) continue
    const signature = pageSignature(currentItems)
    if (signatures.has(signature)) {
      paginationStalled = true
      continue
    }
    signatures.add(signature)
    const novelItems = currentItems.filter((item) => {
      const key = JSON.stringify([intelligenceCanonicalUrl(item.url), item.title])
      return !collected.has(key)
    })
    mergeItems(collected, currentItems)
    const targets = staticNextPages(current.html, source, current.url)
    if (targets.length) recognizedPagination = true
    if (!targets.length) continue
    if (!await allowNext(novelItems, pages)) continue
    for (const target of targets) {
      if (visited.has(target) || queued.has(target)) continue
      queued.add(target)
      queue.push(target)
    }
  }
  const paginationUnverified = maxPages > 1 && marker && !recognizedPagination
  return { ...page, items: [...collected.values()], dynamic: false, pages, capped: queue.length > 0 && attempts >= maxPages, paginationStalled, paginationError, paginationUnverified }
}

/**
 * Fetch one list page. Production collection may continue through a bounded
 * JPaas pagination window only when the caller says the current page still
 * contains unprocessed records. Admin configuration tests intentionally
 * use the default one-page budget.
 */
export async function intelligenceFetchList(url: string, source: IntelligenceSource, column: { name: string, url: string }, options: IntelligenceFetchListOptions = {}) {
  const page = await intelligenceFetchHtml(url, source)
  let items = intelligenceParseList(page.html, source, { ...column, url: page.url })
  if (items.length) return staticPages(page, items, source, column, options)
  const endpoint = intelligenceJPaasUnitUrl(page.html, source, page.url)
  if (!endpoint) return { ...page, items, dynamic: false, pages: 1, capped: false }

  const requestedMax = Number.isSafeInteger(options.maxPages) ? Number(options.maxPages) : 1
  const maxPages = options.maxPages === null ? Number.POSITIVE_INFINITY : Math.max(1, Math.min(jpaasMaxPages, requestedMax))
  let fragment = await dynamicFragment(endpoint, page.url, source, 1)
  items = intelligenceParseList(fragment, source, { ...column, url: page.url })
  const collected = new Map<string, OfficialCandidate>()
  mergeItems(collected, items)
  let pages = 1
  let currentItems = items
  let signature = pageSignature(currentItems)
  const signatures = new Set([signature])
  let paginationStalled = false
  let paginationError: string | undefined
  const allowNext = async () => {
    try {
      return options.shouldContinue ? await options.shouldContinue(currentItems, pages) : true
    } catch (error: any) {
      paginationError = error.message
      return false
    }
  }
  let nextAvailable = nextPageAvailable(fragment, pages, currentItems)
  let continueWanted = nextAvailable && maxPages > 1
    ? await allowNext()
    : false

  while (nextAvailable && continueWanted && pages < maxPages) {
    const nextPage = pages + 1
    try {
      fragment = await dynamicFragment(endpoint, page.url, source, nextPage)
    } catch (error: any) {
      paginationError = error.message
      break
    }
    currentItems = intelligenceParseList(fragment, source, { ...column, url: page.url })
    pages = nextPage
    if (!currentItems.length) {
      nextAvailable = false
      continueWanted = false
      break
    }
    const nextSignature = pageSignature(currentItems)
    if (nextSignature && signatures.has(nextSignature)) {
      paginationStalled = true
      nextAvailable = false
      continueWanted = false
      break
    }
    signature = nextSignature
    signatures.add(signature)
    mergeItems(collected, currentItems)
    nextAvailable = nextPageAvailable(fragment, pages, currentItems)
    continueWanted = nextAvailable && await allowNext()
  }
  const capped = pages >= maxPages && nextAvailable && continueWanted
  return { ...page, items: [...collected.values()], dynamic: true, pages, capped, paginationStalled, paginationError }
}
