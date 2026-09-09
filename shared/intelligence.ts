import { healthTopicLines } from "./topics"

export const intelligenceVersion = "2026-09-08.1"
export type IntelligenceTopic = "building" | "health" | "ai" | "finance"
export const intelligenceTopics = {
  building: { name: "建筑", categories: {
    intelligent_construction: "智能建造", good_housing: "好房子", smart_building: "智慧建筑",
    green_building: "绿色低碳", urban_renewal: "城市更新", industrialization: "建筑工业化", policy: "综合政策与标准",
  } },
  health: { name: "运动健康", categories: healthTopicLines },
  ai: { name: "AI 科技", categories: { models: "大模型", products: "AI 产品", agents: "智能体", coding: "AI 编程", hardware: "AI 硬件", research: "研究与治理" } },
  finance: { name: "财经", categories: { macro: "宏观政策", markets: "市场动态", industry: "产业与公司", property: "房地产" } },
} as const

export const intelligenceContentTypes = ["政策文件", "通知公告", "标准规范", "政策解读", "项目案例", "研究报告", "会议活动", "行业动态", "热点选题"] as const
export interface IntelligenceArticle {
  key: string
  topic: IntelligenceTopic
  title: string
  url: string
  sourceId: string
  sourceName: string
  sourceGroup: string
  sourceLevel: string
  region: string
  city: string
  column: string
  publisher?: string
  publishedAt?: number
  publicationDate?: { status: "verified" | "unknown"; basis?: "article" | "source_api" | "source_list" | "source_id"; url: string; checkedAt: number; reason?: "not_article" | "unavailable" | "not_provided" }
  collectedAt: number
  documentNo?: string
  attachments: { title: string, url: string }[]
  category: string
  relatedCategories: string[]
  tags: string[]
  contentType: string
  importance: number
  summary: string
  reason?: string
  evidence: "body" | "title"
  model: string
  analysisVersion: string
  otherSources?: { name: string, url: string }[]
}
export interface IntelligenceSource {
  id: string
  name: string
  home: string
  group: string
  level: string
  region: string
  city: string
  priority: number
  topic: IntelligenceTopic
  columns?: { name: string, url: string }[]
  newsnowId?: string
  enabled: boolean
  note?: string
}
export interface IntelligenceSourceState {
  id: string
  status: "pending" | "running" | "ok" | "partial" | "error"
  checkedAt?: number
  lastSuccessAt?: number
  fetched?: number
  accepted?: number
  error?: string
  columns?: { name: string, url: string }[]
}
export interface IntelligenceFeed {
  pipeline?: "mac"
  updatedAt?: number
  version: string
  model: string
  aiEnabled: boolean
  persistent: boolean
  articles: IntelligenceArticle[]
  sources: IntelligenceSource[]
  states: IntelligenceSourceState[]
  truncated: boolean
}
export interface IntelligenceFilters {
  q: string
  category: string
  regions: string[]
  cities: string[]
  types: string[]
  sources: string[]
  tags: string[]
  days: number
  importance: number
  sort: "recommended" | "latest" | "importance"
}
export const emptyIntelligenceFilters = (): IntelligenceFilters => ({
  q: "", category: "", regions: [], cities: [], types: [], sources: [], tags: [], days: 0, importance: 0, sort: "latest",
})
export function intelligenceHttpUrl(value: unknown): string | undefined {
  try {
    const u = new URL(String(value))
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return
    return u.href
  } catch { return }
}
export function intelligenceCanonicalUrl(value: string) {
  const safe = intelligenceHttpUrl(value)
  if (!safe) return ""
  const u = new URL(safe)
  u.hash = ""
  for (const key of [...u.searchParams.keys()]) {
    if (/^(utm_|spm$|from$|source$)/i.test(key)) u.searchParams.delete(key)
  }
  u.searchParams.sort()
  return u.href
}
export function intelligenceDate(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined
  if (typeof value !== "string") return
  const match = value.match(/(?:^|\D)((?:19|20)\d{2})[-年/.](\d{1,2})[-月/.](\d{1,2})(?:日|\D|$)/)
  if (!match) return
  const [, year, month, day] = match
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
  const time = Date.parse(`${iso}T00:00:00+08:00`)
  if (!Number.isFinite(time) || new Date(time + 8 * 3600000).toISOString().slice(0, 10) !== iso) return
  return time
}
export function intelligenceFilter<T extends Omit<IntelligenceArticle, "model" | "analysisVersion">>(items: T[], f: IntelligenceFilters, now = Date.now()) {
  const words = f.q.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  return items.filter(a => {
    if (f.category && a.category !== f.category && !a.relatedCategories.includes(f.category)) return false
    if (f.regions.length && !f.regions.includes(a.region)) return false
    if (f.cities.length && !f.cities.includes(a.city)) return false
    if (f.types.length && !f.types.includes(a.contentType)) return false
    if (f.sources.length && !f.sources.includes(a.sourceId) && !f.sources.includes(a.sourceGroup)) return false
    if (f.tags.length && !f.tags.some(tag => a.tags.includes(tag))) return false
    if (f.importance && a.importance < f.importance) return false
    // Unknown publication dates are never substituted with collection dates.
    if (f.days && (!a.publishedAt || a.publishedAt < now - f.days * 86400000 || a.publishedAt > now + 86400000)) return false
    const text = `${a.title} ${a.summary} ${a.documentNo ?? ""} ${a.sourceName} ${a.tags.join(" ")}`.toLocaleLowerCase()
    return words.every(w => text.includes(w))
  }).sort((a, b) => {
    if (f.sort === "importance" || f.sort === "recommended") return b.importance - a.importance || (b.publishedAt ?? 0) - (a.publishedAt ?? 0)
    return (b.publishedAt ?? 0) - (a.publishedAt ?? 0) || b.collectedAt - a.collectedAt
  })
}
export function intelligenceDedupe(items: IntelligenceArticle[]) {
  const output = new Map<string, IntelligenceArticle>()
  const aliases = new Map<string, string>()
  const priority = (a: IntelligenceArticle) => a.sourceLevel === "国家" ? 3 : a.sourceLevel === "省级" ? 2 : 1
  for (const original of items) {
    const a = { ...original, otherSources: [...(original.otherSources ?? [])] }
    const url = intelligenceCanonicalUrl(a.url)
    if (!url) continue
    const title = a.title.replace(/[\s\p{P}]/gu, "").toLowerCase()
    const titleKey = title.length >= 18 && a.publishedAt ? `${a.topic}:${title}:${a.publishedAt}` : ""
    const key = aliases.get(`${a.topic}:${url}`) || (titleKey && aliases.get(titleKey)) || a.key
    aliases.set(`${a.topic}:${url}`, key)
    if (titleKey) aliases.set(titleKey, key)
    const existing = output.get(key)
    if (!existing) { output.set(key, a); continue }
    const preferred = priority(a) > priority(existing) ? a : existing
    const other = preferred === a ? existing : a
    preferred.otherSources = [...(preferred.otherSources ?? []), ...(other.otherSources ?? []), { name: other.sourceName, url: other.url }]
      .filter((s, index, list) => s.url !== preferred.url && list.findIndex(v => v.url === s.url) === index)
    preferred.tags = [...new Set([...preferred.tags, ...other.tags])]
    preferred.relatedCategories = [...new Set([...preferred.relatedCategories, other.category, ...other.relatedCategories])].filter(c => c !== preferred.category)
    output.set(key, preferred)
  }
  return [...output.values()]
}
