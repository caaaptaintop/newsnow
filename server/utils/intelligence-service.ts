import { buildingRecallScore } from "@shared/building-recall"
import { intelligenceSources } from "@shared/official-sources"
import { intelligenceSnapshot } from "@shared/intelligence-snapshot"
import { intelligenceVersion, intelligenceCanonicalUrl, intelligenceDate, intelligenceDedupe, type IntelligenceArticle, type IntelligenceSource, type IntelligenceSourceState, type IntelligenceTopic, type IntelligenceFeed } from "@shared/intelligence"
import { getters } from "#/getters"
import type { SourceID } from "@shared/types"
import { getIntelligenceStore } from "./intelligence-store"
import { intelligenceAI, intelligenceClassify } from "./intelligence-ai"
import { intelligenceFetchHtml, intelligenceDiscoverColumns, intelligenceParseList, intelligenceParseArticle, type OfficialCandidate } from "./intelligence-parser"

interface RefreshOutcome {
  state: IntelligenceSourceState
  articles: IntelligenceArticle[]
  seenKeys: string[]
}
export interface IntelligenceRefreshOptions {
  includeArticles?: boolean
  knownKeys?: string[]
}

const inFlight = new Map<string, Promise<RefreshOutcome>>()
const interval = 6 * 3600000

export async function intelligenceMapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const result: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; result[index] = await fn(items[index]) }
  }))
  return result
}
async function digest(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, "0")).join("")
}
const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 240)

async function collect(source: IntelligenceSource) {
  const warnings: string[] = []
  if (source.newsnowId) {
    const getter = getters[source.newsnowId as SourceID]
    if (!getter) throw new Error("当前部署未提供该 NewsNow 适配器")
    const news = await getter()
    const items: OfficialCandidate[] = news.slice(0, 30).map(item => ({ title: item.title, url: item.url, publishedAt: intelligenceDate(item.pubDate), column: "热点与快讯", attachments: [] }))
    return { items, columns: [{ name: "NewsNow", url: source.home }], warnings }
  }
  let columns = source.columns ?? []
  let home: { html: string, url: string } | undefined
  if (!columns.length) {
    home = await intelligenceFetchHtml(source.home, source)
    columns = intelligenceDiscoverColumns(home.html, source, home.url)
  }
  if (!columns.length) {
    columns = [{ name: "官网公开列表（待细化栏目）", url: home?.url ?? source.home }]
    warnings.push("尚未识别专门栏目，当前仅读取官网公开列表")
  }
  const lists = await intelligenceMapLimit(columns.slice(0, 4), 2, async column => {
    try {
      const page = home && home.url === column.url ? home : await intelligenceFetchHtml(column.url, source)
      return intelligenceParseList(page.html, source, { ...column, url: page.url })
    } catch (error) { warnings.push(`${column.name}：${message(error)}`); return [] }
  })
  const byUrl = new Map<string, OfficialCandidate>()
  for (let i = 0; i < 60; i++) for (const list of lists) {
    const item = list[i]
    if (item && !byUrl.has(intelligenceCanonicalUrl(item.url))) byUrl.set(intelligenceCanonicalUrl(item.url), item)
  }
  const items = [...byUrl.values()]
  if (!items.length) throw new Error(warnings.join("；") || "未解析到文章；可能需要专用栏目适配器，未将空抓取视为成功")
  return { items, columns, warnings }
}

function mergeStates(sources: IntelligenceSource[], runtime: IntelligenceSourceState[]) {
  const allowed = new Set(sources.map(source => source.id))
  const merged = new Map<string, IntelligenceSourceState>()
  for (const state of intelligenceSnapshot.states) if (allowed.has(state.id)) merged.set(state.id, state)
  for (const state of runtime) {
    const previous = merged.get(state.id)
    if (!previous || (state.checkedAt ?? 0) >= (previous.checkedAt ?? 0)) merged.set(state.id, state)
  }
  return sources.map(source => merged.get(source.id) ?? { id: source.id, status: "pending" as const })
}

export async function intelligenceFeed(event: any, topic: IntelligenceTopic): Promise<IntelligenceFeed> {
  const store = await getIntelligenceStore()
  const sources = intelligenceSources.filter(s => s.topic === topic && s.enabled)
  const runtimeStates = intelligenceSnapshot.pipeline === "mac" ? [] : await Promise.all(sources.map(async s => await store.get<IntelligenceSourceState>(`source:${s.id}`))).then(values => values.filter((value): value is IntelligenceSourceState => !!value))
  const runtimeArticles = await store.articles(topic)
  const snapshotArticles = intelligenceSnapshot.articles.filter(article => article.topic === topic)
  // Mac snapshots include verified metadata corrections; legacy database copies must not replace them.
  const mergedArticles = intelligenceDedupe(intelligenceSnapshot.pipeline === "mac" ? [...snapshotArticles, ...runtimeArticles] : [...runtimeArticles, ...snapshotArticles])
  return {
    version: intelligenceVersion,
    pipeline: intelligenceSnapshot.pipeline,
    updatedAt: intelligenceSnapshot.generatedAt,
    model: intelligenceSnapshot.pipeline === "mac" ? "gpt-5.6-luna" : intelligenceAI(event).model,
    aiEnabled: intelligenceSnapshot.pipeline === "mac" || !!intelligenceAI(event)?.run,
    persistent: true,
    sources,
    states: mergeStates(sources, runtimeStates),
    articles: mergedArticles.slice(0, 5000).map(article => intelligenceSnapshot.pipeline === "mac" && article.publicationDate?.status !== "verified" ? { ...article, publishedAt: undefined } : article),
    truncated: mergedArticles.length > 5000,
  }
}

async function updateSource(event: any, source: IntelligenceSource, externalKnownKeys: Set<string>): Promise<RefreshOutcome> {
  const store = await getIntelligenceStore()
  const previous = await store.get<IntelligenceSourceState>(`source:${source.id}`)
  const now = Date.now()
  const retryAfter = previous?.status === "error" || previous?.status === "partial" ? 30 * 60000 : interval
  if (previous?.checkedAt && now - previous.checkedAt < (previous.status === "running" ? 180000 : retryAfter)) return { state: previous, articles: [], seenKeys: [] }
  const ai = intelligenceAI(event)
  if (!ai?.run) {
    const state: IntelligenceSourceState = { id: source.id, status: "error", checkedAt: now, error: "AI 服务配置不可用；未用关键词结果替代 AI" }
    await store.set(`source:${source.id}`, state)
    return { state, articles: [], seenKeys: [] }
  }
  await store.set(`source:${source.id}`, { ...previous, id: source.id, status: "running", checkedAt: now })
  let state: IntelligenceSourceState
  const acceptedArticles: IntelligenceArticle[] = []
  const seenKeys: string[] = []
  try {
    const { items, columns, warnings } = await collect(source)
    const savedTitles = new Map([
      ...(await store.articles(source.topic)).map(article => [article.key, article.title] as const),
      ...intelligenceSnapshot.articles.filter(article => article.topic === source.topic).map(article => [article.key, article.title] as const),
    ])
    const prepared = await intelligenceMapLimit(items, 4, async item => {
      const key = `${source.topic}:${await digest(intelligenceCanonicalUrl(item.url))}`
      const signature = await digest(`${intelligenceVersion}|${ai.model}|${source.id}|${item.title}`)
      const seen = await store.get<{ signature: string, at: number }>(`seen:${source.id}:${key}`)
      return { item, key, signature, seen: savedTitles.get(key) === item.title || externalKnownKeys.has(key) || (seen?.signature === signature && now - seen.at < 7 * 86400000) }
    })
    const unseen = prepared.filter(x => !x.seen)

    // Keywords are only a broad recall gate. AI remains the final classifier.
    // This keeps the free Workers AI quota usable instead of sending every
    // government notice, procurement item and personnel announcement to Gemma.
    let recalled = unseen
    if (source.topic === "building") {
      const scored = unseen.map((entry, index) => ({ entry, index, score: buildingRecallScore(entry.item) }))
      const dropped = scored.filter(row => row.score <= 0)
      for (const row of dropped) {
        seenKeys.push(row.entry.key)
        await store.set(`seen:${source.id}:${row.entry.key}`, { signature: row.entry.signature, at: now })
      }
      recalled = scored
        .filter(row => row.score > 0)
        .sort((a, b) => b.score - a.score || a.index - b.index)
        .map(row => row.entry)
    }

    const candidateLimit = source.topic === "building" ? 6 : 10
    const candidates = recalled.slice(0, candidateLimit)
    let bodyFailures = 0
    const enriched = await intelligenceMapLimit(candidates, 4, async entry => {
      if (source.newsnowId) return entry
      try {
        const page = await intelligenceFetchHtml(entry.item.url, source)
        return { ...entry, item: intelligenceParseArticle(page.html, entry.item, source) }
      } catch { bodyFailures++; return entry }
    })
    let accepted = 0
    let analyzed = 0
    const chunks: typeof enriched[] = []
    for (let i = 0; i < enriched.length; i += 8) chunks.push(enriched.slice(i, i + 8))
    await intelligenceMapLimit(chunks, 2, async chunk => {
      try {
        const decisions = await intelligenceClassify(ai, source.topic, chunk.map(x => ({ key: x.key, title: x.item.title, body: x.item.text?.slice(0, 900), column: x.item.column })))
        for (const { item, key, signature } of chunk) {
          const decision = decisions.get(key)
          if (!decision) continue
          seenKeys.push(key)
          if (decision.keep) {
            const article: IntelligenceArticle = {
              key, topic: source.topic, title: item.title, url: item.url, sourceId: source.id, sourceName: source.name,
              sourceGroup: source.group, sourceLevel: source.level, region: source.region, city: source.city,
              column: item.column, publisher: item.publisher, publishedAt: item.publishedAt, collectedAt: now,
              documentNo: item.documentNo, attachments: item.attachments, category: decision.category,
              relatedCategories: decision.relatedCategories, tags: decision.tags, contentType: decision.contentType,
              importance: decision.importance, summary: decision.summary, reason: decision.reason,
              evidence: item.text ? "body" : "title", model: ai.model, analysisVersion: intelligenceVersion,
            }
            await store.save(article)
            acceptedArticles.push(article)
            accepted++
          } else await store.remove(key)
          await store.set(`seen:${source.id}:${key}`, { signature, at: now })
          analyzed++
        }
      } catch (error) { warnings.push(message(error)) }
    })
    if (bodyFailures) warnings.push(`${bodyFailures} 篇正文获取失败，已按标题证据标记`)
    if (analyzed < candidates.length) warnings.push(`${candidates.length - analyzed} 篇 AI 判断未完成，留待重试`)
    if (recalled.length > candidates.length) warnings.push(`还有 ${recalled.length - candidates.length} 篇关键词召回候选待后续批次处理`)
    state = { id: source.id, status: warnings.length ? "partial" : "ok", checkedAt: now,
      lastSuccessAt: analyzed === candidates.length ? now : previous?.lastSuccessAt,
      fetched: items.length, accepted, columns, error: warnings.join("；").slice(0, 900) || undefined }
  } catch (error) {
    state = { ...previous, id: source.id, status: "error", checkedAt: now, error: message(error) }
  }
  await store.set(`source:${source.id}`, state)
  return { state, articles: acceptedArticles, seenKeys }
}

export async function intelligenceRefresh(event: any, sourceId: string, options: IntelligenceRefreshOptions = {}) {
  const source = intelligenceSources.find(s => s.id === sourceId && s.enabled)
  if (!source) throw createError({ statusCode: 400, message: "未配置的信息源，不接受任意网址" })
  const knownKeys = new Set((options.knownKeys ?? []).filter(key => typeof key === "string").slice(0, 300))
  const flightKey = `${sourceId}:${knownKeys.size ? "snapshot" : "interactive"}`
  const ongoing = inFlight.get(flightKey)
  const outcome = ongoing ?? updateSource(event, source, knownKeys).finally(() => inFlight.delete(flightKey))
  if (!ongoing) inFlight.set(flightKey, outcome)
  const result = await outcome
  return options.includeArticles ? result : result.state
}
