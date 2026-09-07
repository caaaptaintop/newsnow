import type { NewsItem, SourceID, SourceResponse } from "@shared/types"
import { healthTopic } from "@shared/topics"
import { sources } from "@shared/sources"
import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { myFetch } from "~/utils"

interface HealthItem extends NewsItem {
  key: string
  sourceId: SourceID
  sourceName: string
  sourceRank: number
  rankScore: number
  keywordMatched: boolean
  aiScore?: number
  category?: string
  finalScore?: number
}

interface SemanticResponse {
  enabled: boolean
  model?: string
  matches: Array<{
    key: string
    score: number
    category: string
  }>
  error?: string
}

const categoryNames: Record<string, string> = {
  exercise: "运动",
  weight: "体重管理",
  nutrition: "营养",
  sleep: "睡眠",
  metabolic: "代谢健康",
  cardiovascular: "心血管",
  preventive: "预防健康",
  medical_research: "健康研究",
  public_health: "公共健康",
  mental_health: "心理健康",
  other_health: "健康",
}

function normalizeTitle(title: string) {
  return title.toLowerCase().replace(/[\s，。！？、,.!?：:；;“”"'‘’（）()【】\[\]-]/g, "")
}

function matchesHealth(item: NewsItem) {
  const text = [
    item.title,
    item.extra?.hover,
    item.extra?.info || "",
  ].filter(Boolean).join(" ").toLowerCase()

  return healthTopic.keywords.some(keyword => text.includes(keyword.toLowerCase()))
}

function candidateSignature(items: HealthItem[]) {
  let hash = 2166136261
  for (const item of items) {
    const text = `${item.key}|${item.title}`
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
  }
  return (hash >>> 0).toString(36)
}

async function fetchSource(id: SourceID): Promise<SourceResponse> {
  return await myFetch<SourceResponse>(`/s?id=${id}&limit=${healthTopic.sourceLimit}`)
}

export function HealthColumn() {
  const queries = useQueries({
    queries: healthTopic.sources.map(id => ({
      queryKey: ["health-source", id, healthTopic.sourceLimit],
      queryFn: () => fetchSource(id),
      staleTime: 1000 * 60 * 5,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: false,
    })),
  })

  const candidates = useMemo(() => {
    const all: HealthItem[] = []

    queries.forEach((query, sourceIndex) => {
      const id = healthTopic.sources[sourceIndex]
      query.data?.items.forEach((item, rank) => {
        all.push({
          ...item,
          key: `${id}:${String(item.id)}`,
          sourceId: id,
          sourceName: sources[id].name,
          sourceRank: rank + 1,
          // 原榜越靠前越重要，但不再像第一版那样让排名完全压过主题相关性。
          rankScore: Math.max(0, 100 - rank * 0.75 - sourceIndex * 0.25),
          keywordMatched: matchesHealth(item),
        })
      })
    })

    const deduped = new Map<string, HealthItem>()
    all
      .sort((a, b) => b.rankScore - a.rankScore)
      .forEach((item) => {
        const normalized = normalizeTitle(item.title)
        if (!normalized || deduped.has(normalized)) return
        deduped.set(normalized, item)
      })

    return [...deduped.values()]
      .sort((a, b) => b.rankScore - a.rankScore)
      .slice(0, healthTopic.aiCandidateLimit)
  }, [queries])

  const signature = useMemo(() => candidateSignature(candidates), [candidates])
  const isFetchingSources = queries.some(query => query.isFetching)
  const hasError = queries.every(query => query.isError)

  const semanticQuery = useQuery({
    queryKey: ["topic-semantic", "health", signature],
    enabled: !isFetchingSources && candidates.length > 0,
    queryFn: async () => {
      return await myFetch<SemanticResponse>("/topics/health/classify", {
        method: "POST",
        body: {
          items: candidates.map(item => ({
            key: item.key,
            title: item.title,
            source: item.sourceName,
            rank: item.sourceRank,
          })),
        },
      })
    },
    staleTime: 1000 * 60 * 10,
    retry: false,
  })

  const items = useMemo(() => {
    const aiMatches = new Map(
      (semanticQuery.data?.matches ?? []).map(item => [item.key, item]),
    )

    return candidates
      .map((item) => {
        const ai = aiMatches.get(item.key)
        if (!item.keywordMatched && !ai) return null

        // AI 相关度是主排序依据；原榜排名负责区分同等相关的热点。
        const finalScore = ai
          ? ai.score * 0.78 + item.rankScore * 0.22 + (item.keywordMatched ? 3 : 0)
          : 55 + item.rankScore * 0.35

        return {
          ...item,
          aiScore: ai?.score,
          category: ai?.category,
          finalScore,
        }
      })
      .filter((item): item is HealthItem & { finalScore: number } => !!item)
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, healthTopic.displayLimit)
  }, [candidates, semanticQuery.data])

  const handleRefresh = () => {
    queries.forEach(query => query.refetch())
    semanticQuery.refetch()
  }

  const semanticStatus = semanticQuery.isFetching
    ? "正在进行 AI 语义筛选"
    : semanticQuery.data?.enabled
      ? "AI 语义筛选已启用"
      : "关键词筛选；AI 暂未启用"

  return (
    <section className="mx-auto w-full max-w-1100px">
      <div className="mb-4 rounded-2xl bg-green-500/12 p-5 dark:bg-green-500/15">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="i-ph:heartbeat-duotone text-2xl text-green-600 dark:text-green-400" />
              <h1 className="text-2xl font-bold">{healthTopic.name}</h1>
            </div>
            <p className="mt-2 text-sm op-70">{healthTopic.description}</p>
            <p className="mt-1 text-xs op-55">
              当前从百度、微博、知乎、头条、澎湃、B站、虎扑和值得买等来源聚合；每个来源最多扫描 {healthTopic.sourceLimit} 条，{semanticStatus}。
            </p>
          </div>
          <button
            type="button"
            className={$(
              "btn i-ph:arrow-counter-clockwise-duotone text-xl text-green-600 dark:text-green-400",
              (isFetchingSources || semanticQuery.isFetching) && "animate-spin i-ph:circle-dashed-duotone",
            )}
            title="刷新健康管理主题"
            onClick={handleRefresh}
          />
        </div>
      </div>

      <div className="rounded-2xl bg-green-500/12 p-4 dark:bg-green-500/15">
        <div className="rounded-2xl bg-base bg-op-75! p-3">
          {(isFetchingSources || semanticQuery.isFetching) && !items.length && (
            <div className="py-12 text-center text-sm op-60">正在扫描并整理健康管理热点...</div>
          )}

          {!isFetchingSources && !semanticQuery.isFetching && !items.length && !hasError && (
            <div className="py-12 text-center">
              <p className="font-medium">当前未筛到明显的健康管理内容</p>
              <p className="mt-2 text-sm op-60">现在已经扩大到每个来源最多 {healthTopic.sourceLimit} 条；后续还可以继续接入专业健康信息源。</p>
            </div>
          )}

          {hasError && !items.length && (
            <div className="py-12 text-center text-sm op-60">信息源暂时获取失败，请稍后刷新。</div>
          )}

          {!!items.length && (
            <ol className="flex flex-col gap-1">
              {items.map((item, index) => (
                <li key={item.key}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex gap-3 rounded-lg px-2 py-2 transition-all hover:bg-neutral-400/10 visited:text-neutral-400"
                  >
                    <span className="mt-0.5 min-w-7 h-7 flex items-center justify-center rounded-md bg-green-500/10 text-sm font-medium text-green-700 dark:text-green-300">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base leading-6">{item.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs op-55">
                        <span>{item.sourceName}</span>
                        <span>原榜第 {item.sourceRank} 名</span>
                        {item.category && <span>{categoryNames[item.category] ?? "健康"}</span>}
                        {item.aiScore !== undefined && <span>相关度 {item.aiScore}</span>}
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  )
}
