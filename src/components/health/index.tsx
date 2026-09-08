import type { NewsItem, SourceID, SourceResponse } from "@shared/types"
import {
  healthTopic,
  healthTopicLines,
  healthTopicTriggers,
  type HealthTopicLine,
  type HealthTopicTrigger,
} from "@shared/topics"
import { sources } from "@shared/sources"
import { useQueries, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { myFetch } from "~/utils"

interface TopicItem extends NewsItem {
  key: string
  sourceId: SourceID
  sourceName: string
  sourceRank: number
  rankScore: number
  priorityMatched: boolean
  topicScore?: number
  primaryLine?: HealthTopicLine
  auxiliaryLines?: HealthTopicLine[]
  triggers?: HealthTopicTrigger[]
  angle?: string
  reason?: string
  finalScore?: number
}

interface SemanticResponse {
  enabled: boolean
  model: string
  matches: Array<{
    key: string
    score: number
    primaryLine: HealthTopicLine
    auxiliaryLines: HealthTopicLine[]
    triggers: HealthTopicTrigger[]
    angle: string
    reason: string
  }>
  error?: string
}

interface StoredSemanticSnapshot {
  savedAt: number
  data: SemanticResponse
}

const topicSnapshotVersion = "v2"
const topicSnapshotMaxAge = 1000 * 60 * 60 * 24

function normalizeTitle(title: string) {
  return title.toLowerCase().replace(/[\s，。！？、,.!?：:；;“”"'‘’（）()【】\[\]-]/g, "")
}

function matchesPrioritySeed(item: NewsItem) {
  const text = item.title.toLowerCase()
  return healthTopic.seedKeywords.some(keyword => text.includes(keyword.toLowerCase()))
}

function candidateSignature(items: TopicItem[]) {
  let hash = 2166136261
  // 同一批候选即使热榜内部名次有小幅调整，也保持同一签名，避免无意义地重新调用 AI。
  const entries = items.map(item => `${item.key}|${item.title}`).sort()
  for (const text of entries) {
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
  }
  return (hash >>> 0).toString(36)
}

function semanticSnapshotKey(signature: string) {
  return `jianing-hot-topic:${topicSnapshotVersion}:${healthTopic.aiModel}:${signature}`
}

function readSemanticSnapshot(signature: string): SemanticResponse | undefined {
  if (typeof window === "undefined") return

  try {
    const key = semanticSnapshotKey(signature)
    const raw = window.localStorage.getItem(key)
    if (!raw) return

    const stored = JSON.parse(raw) as StoredSemanticSnapshot
    if (!stored?.savedAt || Date.now() - stored.savedAt > topicSnapshotMaxAge) {
      window.localStorage.removeItem(key)
      return
    }

    if (stored.data?.enabled === true
      && stored.data.model === healthTopic.aiModel
      && Array.isArray(stored.data.matches)) {
      return stored.data
    }
  } catch {
    // localStorage 被禁用或旧数据损坏时，直接回到在线 AI 分析。
  }
}

function writeSemanticSnapshot(signature: string, data: SemanticResponse) {
  if (typeof window === "undefined" || data.enabled !== true) return

  try {
    const stored: StoredSemanticSnapshot = {
      savedAt: Date.now(),
      data,
    }
    window.localStorage.setItem(semanticSnapshotKey(signature), JSON.stringify(stored))
  } catch {
    // 快照只是稳定体验的优化，写入失败不影响正常选题。
  }
}

async function fetchSource(id: SourceID): Promise<SourceResponse> {
  return await myFetch<SourceResponse>(`/s?id=${id}&limit=${healthTopic.sourceLimit}`)
}

export function HealthColumn() {
  const queries = useQueries({
    queries: healthTopic.sources.map(id => ({
      queryKey: ["jianing-topic-source", id, healthTopic.sourceLimit],
      queryFn: () => fetchSource(id),
      staleTime: 1000 * 60 * 5,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: false,
    })),
  })

  const candidatePool = useMemo(() => {
    const all: TopicItem[] = []

    queries.forEach((query, sourceIndex) => {
      const id = healthTopic.sources[sourceIndex]
      query.data?.items.forEach((item, rank) => {
        all.push({
          ...item,
          key: `${id}:${String(item.id)}`,
          sourceId: id,
          sourceName: sources[id].name,
          sourceRank: rank + 1,
          rankScore: Math.max(0, 100 - rank * 0.75 - sourceIndex * 0.25),
          priorityMatched: matchesPrioritySeed(item),
        })
      })
    })

    const deduped = new Map<string, TopicItem>()
    all
      .sort((a, b) => b.rankScore - a.rankScore)
      .forEach((item) => {
        const normalized = normalizeTitle(item.title)
        if (!normalized || deduped.has(normalized)) return
        deduped.set(normalized, item)
      })

    return [...deduped.values()]
  }, [queries])

  // 当前只取每个平台前 30 条，因此去重后的候选直接交给 AI；
  // 关键词仅保留为未来扩展能力，不再额外扫描长尾。
  const aiCandidates = useMemo(() => {
    return candidatePool
      .sort((a, b) => b.rankScore - a.rankScore)
      .slice(0, healthTopic.aiCandidateLimit)
  }, [candidatePool])

  const signature = useMemo(() => candidateSignature(aiCandidates), [aiCandidates])
  const isFetchingSources = queries.some(query => query.isFetching)
  const hasSourceError = queries.every(query => query.isError)

  const semanticQuery = useQuery({
    queryKey: ["jianing-hot-topic", topicSnapshotVersion, healthTopic.aiModel, signature],
    enabled: !isFetchingSources && aiCandidates.length > 0,
    queryFn: async () => {
      // 托管大模型即使 temperature=0 仍可能在措辞上有波动。
      // 因此同一批热点在当前浏览器直接复用第一次分析结果；榜单内容变化后 signature 才变化。
      const stored = readSemanticSnapshot(signature)
      if (stored) return stored

      const data = await myFetch<SemanticResponse>("/topics/health/classify", {
        method: "POST",
        timeout: 90_000,
        body: {
          items: aiCandidates.map(item => ({
            key: item.key,
            title: item.title,
            source: item.sourceName,
            rank: item.sourceRank,
          })),
        },
      })

      writeSemanticSnapshot(signature, data)
      return data
    },
    staleTime: 1000 * 60 * 10,
    retry: false,
  })

  const items = useMemo(() => {
    if (semanticQuery.data?.enabled !== true) return []

    const aiMatches = new Map(
      semanticQuery.data.matches.map(item => [item.key, item]),
    )

    return candidatePool
      .map((item) => {
        const ai = aiMatches.get(item.key)
        if (!ai) return null

        // 模型内部判断只作为隐藏排序信号，原热榜位置作为较轻的热度信号；前端不显示分值。
        const finalScore = ai.score * 0.88 + item.rankScore * 0.12

        return {
          ...item,
          topicScore: ai.score,
          primaryLine: ai.primaryLine,
          auxiliaryLines: ai.auxiliaryLines,
          triggers: ai.triggers,
          angle: ai.angle,
          reason: ai.reason,
          finalScore,
        }
      })
      .filter((item): item is TopicItem & { finalScore: number } => !!item)
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, healthTopic.displayLimit)
  }, [candidatePool, semanticQuery.data])

  const handleRefresh = async () => {
    // 刷新只更新各平台热榜。候选没有变化时保留当前分析；
    // 候选发生变化时 signature 自动变化，再生成一份新的选题快照。
    await Promise.all(queries.map(query => query.refetch()))
  }

  const aiStatus = semanticQuery.isFetching
    ? `${healthTopic.aiLabel} 正在分析 ${aiCandidates.length} 条热点`
    : semanticQuery.data?.enabled
      ? `${healthTopic.aiLabel} 已完成热点选题筛选`
      : semanticQuery.data?.error?.includes("binding")
        ? "Workers AI 暂不可用"
        : semanticQuery.isError || semanticQuery.data?.error
          ? "热点选题 AI 暂不可用"
          : "准备进行热点选题判断"

  const aiUnavailable = !isFetchingSources
    && !semanticQuery.isFetching
    && aiCandidates.length > 0
    && (semanticQuery.isError || !!semanticQuery.data?.error || semanticQuery.data?.enabled === false)

  return (
    <section className="mx-auto w-full max-w-1100px">
      <div className="mb-4 rounded-2xl bg-green-500/12 p-5 dark:bg-green-500/15">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="i-ph:target-duotone text-2xl text-green-600 dark:text-green-400" />
              <h1 className="text-2xl font-bold">{healthTopic.name}</h1>
            </div>
            <p className="mt-2 text-sm op-70">{healthTopic.description}</p>
            <p className="mt-1 text-xs op-55">
              每个平台只取前 {healthTopic.sourceLimit} 条热点；去重后由 {healthTopic.aiLabel} 按健宁历史高表现选题逻辑筛选并排序。同一批热点在当前浏览器固定复用同一份分析结果，只有榜单内容变化后才重新分析。{aiStatus}。
            </p>
          </div>
          <button
            type="button"
            className={$(
              "btn i-ph:arrow-counter-clockwise-duotone text-xl text-green-600 dark:text-green-400",
              (isFetchingSources || semanticQuery.isFetching) && "animate-spin i-ph:circle-dashed-duotone",
            )}
            title="刷新健宁热点选题"
            onClick={handleRefresh}
          />
        </div>
      </div>

      <div className="rounded-2xl bg-green-500/12 p-4 dark:bg-green-500/15">
        <div className="rounded-2xl bg-base bg-op-75! p-3">
          {isFetchingSources && (
            <div className="py-12 text-center text-sm op-60">正在读取各平台前 {healthTopic.sourceLimit} 条热点...</div>
          )}

          {!isFetchingSources && semanticQuery.isFetching && (
            <div className="py-12 text-center text-sm op-60">已汇总 {aiCandidates.length} 条去重候选，正在用 {healthTopic.aiLabel} 提炼健宁选题...</div>
          )}

          {aiUnavailable && (
            <div className="py-12 text-center">
              <p className="font-medium">热点选题 AI 暂不可用</p>
              <p className="mt-2 text-sm op-60">本页不会用关键词结果代替 AI 选题，以免无关热点影响判断。请稍后刷新。</p>
            </div>
          )}

          {!isFetchingSources && !semanticQuery.isFetching && semanticQuery.data?.enabled && !items.length && (
            <div className="py-12 text-center">
              <p className="font-medium">本轮暂未筛到合适的健宁热点选题</p>
              <p className="mt-2 text-sm op-60">可以稍后刷新，等待各平台出现新的热点。</p>
            </div>
          )}

          {hasSourceError && !semanticQuery.isFetching && !items.length && (
            <div className="py-12 text-center text-sm op-60">信息源暂时获取失败，请稍后刷新。</div>
          )}

          {!isFetchingSources && !semanticQuery.isFetching && !!items.length && (
            <ol className="flex flex-col gap-2">
              {items.map((item, index) => (
                <li key={item.key}>
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex gap-3 rounded-xl px-2 py-3 transition-all hover:bg-neutral-400/10 visited:text-neutral-400"
                  >
                    <span className="mt-0.5 min-w-7 h-7 flex items-center justify-center rounded-md bg-green-500/10 text-sm font-medium text-green-700 dark:text-green-300">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-medium leading-6">{item.title}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs op-55">
                        <span>{item.sourceName}</span>
                        <span>原榜第 {item.sourceRank} 名</span>
                        {item.primaryLine && <span>主线：{healthTopicLines[item.primaryLine]}</span>}
                        {!!item.auxiliaryLines?.length && (
                          <span>辅助：{item.auxiliaryLines.map(line => healthTopicLines[line]).join("、")}</span>
                        )}
                        {!!item.triggers?.length && (
                          <span>触发：{item.triggers.map(trigger => healthTopicTriggers[trigger]).join("、")}</span>
                        )}
                      </span>

                      {item.angle && (
                        <span className="mt-2 block rounded-lg bg-green-500/8 px-3 py-2 text-sm leading-6">
                          <span className="mr-2 text-xs font-medium op-55">建议切入</span>
                          <span>{item.angle}</span>
                        </span>
                      )}

                      {item.reason && (
                        <span className="mt-2 block text-sm leading-6 op-70">
                          <span className="mr-2 text-xs font-medium op-55">选题判断</span>
                          <span>{item.reason}</span>
                        </span>
                      )}
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
