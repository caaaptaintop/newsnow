import { healthTopic } from "@shared/topics"
import { intelligenceSources } from "@shared/official-sources"
import { intelligenceVersion, intelligenceCanonicalUrl, intelligenceDate, intelligenceDedupe, type IntelligenceArticle, type IntelligenceSource, type IntelligenceSourceState, type IntelligenceTopic, type IntelligenceFeed } from "@shared/intelligence"
import { getters } from "#/getters"
import type { SourceID } from "@shared/types"
import { getIntelligenceStore } from "./intelligence-store"
import { intelligenceAI, intelligenceClassify } from "./intelligence-ai"
import { intelligenceFetchHtml, intelligenceDiscoverColumns, intelligenceParseList, intelligenceParseArticle, type OfficialCandidate } from "./intelligence-parser"

const inFlight = new Map<string, Promise<IntelligenceSourceState>>()
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

export async function intelligenceFeed(event: any, topic: IntelligenceTopic): Promise<IntelligenceFeed> {
  const store = await getIntelligenceStore()
  const sources = intelligenceSources.filter(s => s.topic === topic && s.enabled)
  const states = await Promise.all(sources.map(async s => await store.get<IntelligenceSourceState>(`source:${s.id}`) ?? { id: s.id, status: "pending" as const }))
  const all = await store.articles(topic)
  return { version: intelligenceVersion, model: healthTopic.aiModel, aiEnabled: !!intelligenceAI(event)?.run, persistent: store.persistent, sources, states, articles: intelligenceDedupe(all.slice(0, 5000)), truncated: all.length > 5000 }
}

async function updateSource(event: any, source: IntelligenceSource): Promise<IntelligenceSourceState> {
  const store = await getIntelligenceStore()
  const previous = await store.get<IntelligenceSourceState>(`source:${source.id}`)
  const now = Date.now()
  const retryAfter = previous?.status === "error" || previous?.status === "partial" ? 30 * 60000 : interval
  if (previous?.checkedAt && now - previous.checkedAt < (previous.status === "running" ? 180000 : retryAfter)) return previous
  const ai = intelligenceAI(event)
  if (!ai?.run) return { id: source.id, status: "error", checkedAt: now, error: "Workers AI 绑定不可用；未用关键词结果替代 AI" }
  await store.set(`source:${source.id}`, { ...previous, id: source.id, status: "running", checkedAt: now })
  let state: IntelligenceSourceState
  try {
    const { items, columns, warnings } = await collect(source)
    const prepared = await intelligenceMapLimit(items, 4, async item => {
      const key = `${source.topic}:${await digest(intelligenceCanonicalUrl(item.url))}`
      const signature = await digest(`${intelligenceVersion}|${healthTopic.aiModel}|${source.id}|${item.title}`)
      const seen = await store.get<{ signature: string, at: number }>(`seen:${source.id}:${key}`)
      return { item, key, signature, seen: seen?.signature === signature && now - seen.at < 7 * 86400000 }
    })
    const unseen = prepared.filter(x => !x.seen)
    const candidates = unseen.slice(0, 24)
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
    await intelligenceMapLimit(chunks, 3, async chunk => {
      try {
        const decisions = await intelligenceClassify(ai, source.topic, chunk.map(x => ({ key: x.key, title: x.item.title, body: x.item.text?.slice(0, 4500), column: x.item.column })))
        for (const { item, key, signature } of chunk) {
          const decision = decisions.get(key)
          if (!decision) continue
          if (decision.keep) {
            const article: IntelligenceArticle = {
              key, topic: source.topic, title: item.title, url: item.url, sourceId: source.id, sourceName: source.name,
              sourceGroup: source.group, sourceLevel: source.level, region: source.region, city: source.city,
              column: item.column, publisher: item.publisher, publishedAt: item.publishedAt, collectedAt: now,
              documentNo: item.documentNo, attachments: item.attachments, category: decision.category,
              relatedCategories: decision.relatedCategories, tags: decision.tags, contentType: decision.contentType,
              importance: decision.importance, summary: decision.summary, reason: decision.reason,
              evidence: item.text ? "body" : "title", model: healthTopic.aiModel, analysisVersion: intelligenceVersion,
            }
            await store.save(article)
            accepted++
          } else await store.remove(key)
          await store.set(`seen:${source.id}:${key}`, { signature, at: now })
          analyzed++
        }
      } catch (error) { warnings.push(message(error)) }
    })
    if (bodyFailures) warnings.push(`${bodyFailures} 篇正文获取失败，已按标题证据标记`)
    if (analyzed < candidates.length) warnings.push(`${candidates.length - analyzed} 篇 AI 判断未完成，留待重试`)
    if (unseen.length > candidates.length) warnings.push(`还有 ${unseen.length - candidates.length} 篇候选待后续批次处理`)
    state = { id: source.id, status: warnings.length ? "partial" : "ok", checkedAt: now,
      lastSuccessAt: analyzed === candidates.length ? now : previous?.lastSuccessAt,
      fetched: items.length, accepted, columns, error: warnings.join("；").slice(0, 900) || undefined }
  } catch (error) {
    state = { ...previous, id: source.id, status: "error", checkedAt: now, error: message(error) }
  }
  await store.set(`source:${source.id}`, state)
  return state
}
export async function intelligenceRefresh(event: any, sourceId: string) {
  const source = intelligenceSources.find(s => s.id === sourceId && s.enabled)
  if (!source) throw createError({ statusCode: 400, message: "未配置的信息源，不接受任意网址" })
  const ongoing = inFlight.get(sourceId)
  if (ongoing) return ongoing
  const task = updateSource(event, source).finally(() => inFlight.delete(sourceId))
  inFlight.set(sourceId, task)
  return task
}
