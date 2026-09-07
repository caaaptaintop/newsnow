import type { NewsItem, SourceID, SourceResponse } from "@shared/types"
import { healthTopic } from "@shared/topics"
import { sources } from "@shared/sources"
import { useQueries } from "@tanstack/react-query"
import { useMemo } from "react"
import { useRefetch } from "~/hooks/useRefetch"
import { cacheSources, refetchSources } from "~/utils/data"
import { myFetch, safeParseString } from "~/utils"

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
  let url = `/s?id=${id}`
  const headers: Record<string, string> = {}

  if (refetchSources.has(id)) {
    url = `/s?id=${id}&latest`
    const jwt = safeParseString(localStorage.getItem("jwt"))
    if (jwt) headers.Authorization = `Bearer ${jwt}`
    refetchSources.delete(id)
  } else if (cacheSources.has(id)) {
    return cacheSources.get(id)!
  }

  const response = await myFetch<SourceResponse>(url, { headers })
  cacheSources.set(id, response)
  return response
}

export function HealthColumn() {
  const { refresh } = useRefetch()
  const queries = useQueries({
    queries: healthTopic.sources.map(id => ({
      queryKey: ["source", id],
      queryFn: () => fetchSource(id),
      staleTime: Infinity,
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
      .slice(0, 40)
  }, [queries])

  const isFetching = queries.some(query => query.isFetching)
  const hasError = queries.every(query => query.isError)

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
            <p className="mt-1 text-xs op-50">当前从百度、微博、知乎、头条、澎湃、B站、虎扑和值得买等现有热榜中自动筛选。</p>
          </div>
          <button
            type="button"
            className={$(
              "btn i-ph:arrow-counter-clockwise-duotone text-xl text-green-600 dark:text-green-400",
              isFetching && "animate-spin i-ph:circle-dashed-duotone",
            )}
            title="刷新健康管理主题"
            onClick={() => refresh(...healthTopic.sources)}
          />
        </div>
      </div>

      <div className="rounded-2xl bg-green-500/12 p-4 dark:bg-green-500/15">
        <div className="rounded-2xl bg-base bg-op-75! p-3">
          {isFetching && !items.length && (
            <div className="py-12 text-center text-sm op-60">正在整理健康管理热点...</div>
          )}

          {!isFetching && !items.length && !hasError && (
            <div className="py-12 text-center">
              <p className="font-medium">当前热榜暂未筛到明显的健康管理内容</p>
              <p className="mt-2 text-sm op-60">这不代表没有健康新闻，只表示现有热榜前列暂时没有匹配内容。后续可以再接入专业健康信息源。</p>
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
