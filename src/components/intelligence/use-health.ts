import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { sources } from "@shared/sources"
import { healthTopic, healthTopicTriggers, type HealthTopicLine, type HealthTopicTrigger } from "@shared/topics"
import { intelligenceDate, intelligenceVersion, type IntelligenceArticle, type IntelligenceSource, type IntelligenceSourceState } from "@shared/intelligence"
import type { SourceResponse } from "@shared/types"
import { myFetch } from "~/utils"

type HealthSourceId = keyof typeof sources & string
interface SemanticResponse {
  enabled: boolean
  model: string
  matches: { key: string, score: number, primaryLine: HealthTopicLine, auxiliaryLines: HealthTopicLine[], triggers: HealthTopicTrigger[], angle: string, reason: string }[]
  error?: string
}

// SourceID is generated from the adapter registry and can temporarily drift from
// the runtime sources.json during source migrations. Never let one stale source
// id crash the whole intelligence workspace, including unrelated themes.
const healthSourceIds = (healthTopic.sources as readonly HealthSourceId[])
  .filter(id => Boolean((sources as Record<string, unknown>)[id]))

export function useHealthIntelligence(enabled: boolean) {
  const configuration = useQuery({
    queryKey: ["intelligence-ai-configuration"],
    queryFn: () => myFetch<{ enabled: boolean, model: string }>("/topics/health/status"),
    enabled, staleTime: 60000, retry: false,
  })
  const activeModel = configuration.data?.model
  const queries = useQueries({ queries: healthSourceIds.map((id: HealthSourceId) => ({
    queryKey: ["jianing-topic-source", id, healthTopic.sourceLimit],
    queryFn: () => myFetch<SourceResponse>(`/s?id=${id}&limit=${healthTopic.sourceLimit}`),
    enabled, staleTime: 300000, refetchOnMount: false, refetchOnReconnect: false, refetchOnWindowFocus: false, retry: false,
  })) })
  const candidates = useMemo(() => {
    const entries = queries.flatMap((query, sourceIndex) => {
      const id = healthSourceIds[sourceIndex]
      const source = id ? sources[id] : undefined
      const data = query.data as SourceResponse | undefined
      if (!id || !source) return []
      return (data?.items ?? []).map((item, rank) => ({ ...item,
        key: `${id}:${String(item.id)}`, sourceId: id, sourceName: source.name, sourceRank: rank + 1,
        rankScore: Math.max(0, 100 - rank * 0.75 - sourceIndex * 0.25), collected: Number(data?.updatedTime) || query.dataUpdatedAt,
      }))
    }).sort((a, b) => b.rankScore - a.rankScore)
    const deduped = new Map<string, typeof entries[number]>()
    for (const item of entries) {
      const title = item.title.toLowerCase().replace(/[\s，。！？、,.!?：:；;“”"'‘’（）()【】\[\]-]/g, "")
      if (title && !deduped.has(title)) deduped.set(title, item)
    }
    return [...deduped.values()].slice(0, healthTopic.aiCandidateLimit)
  }, [queries])
  const signature = useMemo(() => {
    let hash = 2166136261
    for (const text of candidates.map(item => `${item.key}|${item.title}`).sort()) {
      for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619) }
    }
    return (hash >>> 0).toString(36)
  }, [candidates])
  const fetchingSources = enabled && queries.some(q => q.isFetching)
  const semantic = useQuery({
    queryKey: ["jianing-hot-topic", "v2", activeModel, signature],
    enabled: enabled && configuration.data?.enabled === true && !fetchingSources && candidates.length > 0,
    queryFn: async () => {
      const key = `jianing-hot-topic:v2:${activeModel}:${signature}`
      try {
        const raw = localStorage.getItem(key)
        if (raw) {
          const cached = JSON.parse(raw)
          if (Date.now() - cached.savedAt < 86400000 && cached.data?.enabled === true && cached.data.model === activeModel && Array.isArray(cached.data.matches)) return cached.data as SemanticResponse
        }
      } catch { /* Storage is optional; never replace the editorial classifier with rules. */ }
      const data = await myFetch<SemanticResponse>("/topics/health/classify", {
        method: "POST", timeout: activeModel.startsWith("glm-5.3") ? 120000 : 90000,
        body: { items: candidates.map(item => ({ key: item.key, title: item.title, source: item.sourceName, rank: item.sourceRank })) },
      })
      if (data.enabled) try { localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data })) } catch { /* Optional cache. */ }
      return data
    },
    staleTime: 600000, retry: false, refetchOnWindowFocus: false,
  })
  const articles: IntelligenceArticle[] = useMemo(() => {
    if (!semantic.data?.enabled) return []
    const matches = new Map(semantic.data.matches.map(m => [m.key, m]))
    return candidates.flatMap(item => {
      const match = matches.get(item.key)
      if (!match) return []
      return [{
        key: item.key, topic: "health" as const, title: item.title, url: item.url, sourceId: item.sourceId,
        sourceName: item.sourceName, sourceGroup: "NewsNow", sourceLevel: "平台", region: "", city: "", column: `原榜第 ${item.sourceRank} 名`,
        publishedAt: intelligenceDate(item.pubDate), collectedAt: item.collected, attachments: [],
        category: match.primaryLine, relatedCategories: match.auxiliaryLines ?? [], tags: (match.triggers ?? []).map(t => healthTopicTriggers[t]).filter(Boolean),
        contentType: "热点选题", importance: match.score * 0.88 + item.rankScore * 0.12,
        summary: match.angle, reason: match.reason, evidence: "title" as const, model: semantic.data!.model, analysisVersion: intelligenceVersion,
      }]
    }).sort((a, b) => b.importance - a.importance).slice(0, healthTopic.displayLimit)
  }, [candidates, semantic.data])
  const sourceList: IntelligenceSource[] = healthSourceIds.flatMap((id: HealthSourceId) => {
    const source = sources[id]
    return source ? [{ id, name: source.name, home: source.home ?? "", group: "NewsNow", level: "平台", region: "", city: "", priority: 50, topic: "health" as const, enabled: true }] : []
  })
  const states: IntelligenceSourceState[] = queries.flatMap((q, index) => {
    const id = healthSourceIds[index]
    if (!id) return []
    const data = q.data as SourceResponse | undefined
    return [{ id, status: q.isFetching ? "running" as const : q.isError ? "error" as const : data ? "ok" as const : "pending" as const, checkedAt: q.dataUpdatedAt || undefined, fetched: data?.items.length, error: q.isError ? "平台热榜读取失败" : undefined }]
  })
  return {
    articles, sources: sourceList, states, loading: fetchingSources || (enabled && semantic.isFetching),
    aiEnabled: semantic.data?.enabled ?? false,
    error: configuration.isError ? "AI 配置读取失败" : configuration.data?.enabled === false ? "AI 服务尚未配置" : queries.length > 0 && queries.every(q => q.isError) ? "全部平台热榜读取失败" : semantic.isError ? "健宁选题 AI 请求失败" : semantic.data?.error,
    progress: fetchingSources ? "正在读取各平台前 30 条热点" : semantic.isFetching ? `正在分析 ${candidates.length} 条去重热点` : "",
    refresh: async () => {
      await Promise.all(queries.map(q => q.refetch()))
      if (semantic.isError || semantic.data?.enabled === false) await semantic.refetch()
    },
  }
}
