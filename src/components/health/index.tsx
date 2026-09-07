import type { NewsItem, SourceID, SourceResponse } from "@shared/types"
import { healthTopic } from "@shared/topics"
import { sources } from "@shared/sources"
import { useQueries } from "@tanstack/react-query"
import { useMemo } from "react"
import { myFetch } from "~/utils"

interface HealthItem extends NewsItem {
  sourceId: SourceID
  sourceName: string
  sourceRank: number
  score: number
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

  const items = useMemo(() => {
    const all: HealthItem[] = []

    queries.forEach((query, sourceIndex) => {
      const id = healthTopic.sources[sourceIndex]
      query.data?.items.forEach((item, rank) => {
        if (!matchesHealth(item)) return
        all.push({
          ...item,
          sourceId: id,
          sourceName: sources[id].name,
          sourceRank: rank + 1,
          score: 100 - rank * 3 - sourceIndex,
        })
      })
    })

    const seen = new Set<string>()
    return all
      .sort((a, b) => b.score - a.score)
      .filter((item) => {
        const key = normalizeTitle(item.title)
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, healthTopic.displayLimit)
  }, [queries])

  const isFetching = queries.some(query => query.isFetching)
  const hasError = queries.every(query => query.isError)

  const handleRefresh = () => {
    queries.forEach(query => query.refetch())
  }

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
              当前从百度、微博、知乎、头条、澎湃、B站、虎扑和值得买等来源按原有关键词筛选；每个来源最多扫描 {healthTopic.sourceLimit} 条。
            </p>
          </div>
          <button
            type="button"
            className={$(
              "btn i-ph:arrow-counter-clockwise-duotone text-xl text-green-600 dark:text-green-400",
              isFetching && "animate-spin i-ph:circle-dashed-duotone",
            )}
            title="刷新健康管理主题"
            onClick={handleRefresh}
          />
        </div>
      </div>

      <div className="rounded-2xl bg-green-500/12 p-4 dark:bg-green-500/15">
        <div className="rounded-2xl bg-base bg-op-75! p-3">
          {isFetching && !items.length && (
            <div className="py-12 text-center text-sm op-60">正在深度扫描并整理健康管理热点...</div>
          )}

          {!isFetching && !items.length && !hasError && (
            <div className="py-12 text-center">
              <p className="font-medium">当前未筛到明显的健康管理内容</p>
              <p className="mt-2 text-sm op-60">现在已经扩大到每个来源最多 {healthTopic.sourceLimit} 条，筛选规则仍然是原来的关键词匹配。</p>
            </div>
          )}

          {hasError && !items.length && (
            <div className="py-12 text-center text-sm op-60">信息源暂时获取失败，请稍后刷新。</div>
          )}

          {!!items.length && (
            <ol className="flex flex-col gap-1">
              {items.map((item, index) => (
                <li key={`${item.sourceId}-${item.id}`}>
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
