import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { emptyIntelligenceFilters, intelligenceContentTypes, intelligenceFilter, intelligenceHttpUrl, intelligenceTopics, type IntelligenceFilters } from "@shared/intelligence"
import { isPublishedTopic, publicSite } from "@shared/public-site"
import type { PublicIntelligenceArticle, PublicIntelligenceFeed, PublicIntelligenceSource } from "@shared/public-intelligence"
import { AttachmentList } from "../attachment-preview"
import { LocationFilter, MultiFilter, type LocationGroup } from "./filters"
import "~/styles/intelligence.css"
import "./building.css"

const topic = publicSite.defaultTopic
const categories: Record<string, string> = intelligenceTopics[topic].categories
const emptyArticles: PublicIntelligenceArticle[] = []
const emptySources: PublicIntelligenceSource[] = []
const options = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")).map(value => ({ id: value, name: value }))
const displayDate = (value?: number) => value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value) : "发布日期待核实"

export function buildingView(search = "") {
  const params = new URLSearchParams(search)
  const topics = params.getAll("topic")
  const unavailable = topics.length > 1 || (topics.length === 1 && !isPublishedTopic(topics[0]))
  const filters = emptyIntelligenceFilters()
  const category = params.get("category") ?? ""
  if (Object.hasOwn(categories, category)) filters.category = category
  filters.q = (params.get("q") ?? "").slice(0, 200)
  for (const key of ["regions", "cities", "types", "sources", "tags"] as const) filters[key] = [...new Set(params.getAll(key).filter(value => value.length > 0 && value.length <= 200))].slice(0, 30)
  const days = Number(params.get("days")); if ([7, 30, 90, 365].includes(days)) filters.days = days
  const importance = Number(params.get("importance")); if ([60, 80].includes(importance)) filters.importance = importance
  const sort = params.get("sort"); if (sort === "recommended" || sort === "importance") filters.sort = sort
  return { filters, unavailable }
}
async function request<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]), credentials: "omit" })
  if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}），请稍后刷新`)
  return response.json() as Promise<T>
}
function Icon({ kind }: { kind: "search" | "refresh" | "external" | "sources" }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "search" && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>}
    {kind === "refresh" && <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9" /></>}
    {kind === "external" && <><path d="M14 4h6v6m0-6-9 9M10 5H5v14h14v-5" /></>}
    {kind === "sources" && <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7" /></>}
  </svg>
}
function Brand() {
  return <header className="intel-topbar"><a href="/?topic=building" className="intel-brand"><span className="intel-brand-mark">情</span><span>个人信息情报站<small>CAPX · INTELLIGENCE</small></span></a><span className="intel-current-topic">建筑情报</span></header>
}
function ArticleCard({ article }: { article: PublicIntelligenceArticle }) {
  const url = intelligenceHttpUrl(article.url)
  return <article className="intel-card">
    <div className="intel-meta"><span className="intel-source-name">{article.sourceName}</span>{article.sourceGroup === "住建官方" && <span className="intel-official">官方</span>}<span>{[article.region, article.city && article.city !== article.region ? article.city : ""].filter(Boolean).join(" / ")}</span><time title={article.publicationDate?.status === "verified" ? "已核对信息源发布时间" : "信息源发布时间尚未核实"}>{displayDate(article.publishedAt)}</time></div>
    <h2>{url ? <a href={url} target="_blank" rel="noreferrer">{article.title}<Icon kind="external" /></a> : article.title}</h2>
    <p className="intel-summary"><span>{article.evidence === "body" ? "AI 摘要" : "标题概述"}</span>{article.summary}</p>
    <div className="intel-card-labels"><span>{categories[article.category] ?? article.category}</span><span>{article.contentType}</span>{(article.tags ?? []).map(tag => <span key={tag}>{tag}</span>)}</div>
    <div className="intel-card-foot"><span>{article.column}</span>{article.documentNo && <span>{article.documentNo}</span>}<span>{article.evidence === "title" ? "仅依据标题分析" : "依据已提取正文分析"}</span><span title="AI 编辑排序信号，不代表法定效力或客观评价">{article.importance >= 80 ? "重点关注" : article.importance >= 60 ? "值得关注" : "一般信息"}</span></div>
    <AttachmentList article={article} />
    {!!article.otherSources?.length && <details className="intel-attachments"><summary>其他转载来源 {article.otherSources.length} 个</summary>{article.otherSources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.name}</a>)}</details>}
  </article>
}
function SourcePanel({ sources }: { sources: PublicIntelligenceSource[] }) {
  return <section className="intel-source-panel" aria-label="建筑信息源"><h2>建筑信息源</h2><p className="intel-muted">信息来自以下公开网站。来源清单不等于已完整收录，具体内容以原站发布为准。</p><div className="intel-source-grid">{sources.map(source => <article key={source.id}><a href={source.home} target="_blank" rel="noreferrer">{source.name}</a><p>{[source.group, source.region, source.city && source.city !== source.region ? source.city : ""].filter(Boolean).join(" · ")}</p></article>)}</div></section>
}
export function BuildingWorkspace() {
  const [view, setView] = useState(() => buildingView())
  const [ready, setReady] = useState(false)
  const [showSources, setShowSources] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string>()
  const [visible, setVisible] = useState(40)
  const { filters, unavailable } = view
  const feed = useQuery({ queryKey: ["public-intelligence", topic], queryFn: ({ signal }) => request<PublicIntelligenceFeed>(`/api/intelligence?topic=${topic}`, signal), enabled: ready && !unavailable, staleTime: Infinity, refetchOnWindowFocus: false, retry: false })
  const version = useQuery({ queryKey: ["public-intelligence-version", topic], queryFn: ({ signal }) => request<{ version: string, updatedAt?: number }>(`/api/intelligence/version?topic=${topic}`, signal), enabled: ready && !unavailable && !!feed.data, staleTime: publicSite.versionPollMs, refetchInterval: publicSite.versionPollMs, refetchIntervalInBackground: false, refetchOnWindowFocus: true, retry: false })
  const articles = feed.data?.articles ?? emptyArticles
  const sources = feed.data?.sources ?? emptySources
  const patch = (change: Partial<IntelligenceFilters>) => { setView(current => ({ ...current, filters: { ...current.filters, ...change } })); setVisible(40) }
  const refresh = async () => { await feed.refetch(); await version.refetch() }
  const reset = () => patch({ ...emptyIntelligenceFilters(), category: filters.category })

  useEffect(() => { setView(buildingView(window.location.search)); setReady(true) }, [])
  useEffect(() => {
    if (!ready) return
    document.title = unavailable ? "主题暂未开放 · 个人信息情报站" : "建筑情报 · 个人信息情报站"
    if (unavailable) return
    const params = new URLSearchParams({ topic })
    if (filters.category) params.set("category", filters.category)
    if (filters.q) params.set("q", filters.q)
    for (const key of ["regions", "cities", "types", "sources", "tags"] as const) for (const value of filters[key]) params.append(key, value)
    if (filters.days) params.set("days", String(filters.days))
    if (filters.importance) params.set("importance", String(filters.importance))
    params.set("sort", filters.sort)
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params}`)
  }, [ready, unavailable, filters])
  useEffect(() => {
    const pop = () => { setView(buildingView(window.location.search)); setActiveFilter(undefined); setVisible(40) }
    window.addEventListener("popstate", pop)
    return () => window.removeEventListener("popstate", pop)
  }, [])
  useEffect(() => {
    if (!activeFilter) return
    const outside = (event: Event) => { if (!(event.target instanceof Element) || !event.target.closest(".intel-filter")) setActiveFilter(undefined) }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      document.querySelector<HTMLButtonElement>(".intel-filter-trigger[aria-expanded=true]")?.focus()
      setActiveFilter(undefined)
    }
    document.addEventListener("pointerdown", outside)
    document.addEventListener("focusin", outside)
    document.addEventListener("keydown", escape)
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); document.removeEventListener("keydown", escape) }
  }, [activeFilter])

  const filtered = useMemo(() => {
    const withoutLocation = intelligenceFilter(articles, { ...filters, regions: [], cities: [] })
    return filters.regions.length || filters.cities.length ? withoutLocation.filter(article => filters.regions.includes(article.region) || filters.cities.includes(article.city)) : withoutLocation
  }, [articles, filters])
  const counts = useMemo(() => Object.fromEntries(Object.keys(categories).map(category => [category, articles.filter(article => article.category === category || (article.relatedCategories ?? []).includes(category)).length])), [articles])
  const locationGroups = useMemo<LocationGroup[]>(() => {
    const grouped = new Map<string, Set<string>>()
    for (const item of [...sources, ...articles]) {
      const region = item.region?.trim()
      if (!region) continue
      const cities = grouped.get(region) ?? new Set<string>()
      if (item.city?.trim() && item.city.trim() !== region) cities.add(item.city.trim())
      grouped.set(region, cities)
    }
    return [...grouped.entries()].sort(([a], [b]) => a === b ? 0 : a === "全国" ? -1 : b === "全国" ? 1 : a.localeCompare(b, "zh-CN")).map(([region, cities]) => ({ region, cities: [...cities].sort((a, b) => a.localeCompare(b, "zh-CN")) }))
  }, [sources, articles])
  const tags = options(articles.flatMap(article => article.tags ?? []))
  const sourceOptions = [...options(sources.map(source => source.group)), ...sources.map(source => ({ id: source.id, name: source.name }))]
  const selected = (["regions", "cities", "types", "sources", "tags"] as const).flatMap(key => filters[key].map(value => ({ key, value, label: key === "sources" ? sourceOptions.find(option => option.id === value)?.name ?? value : value })))
  const toggle = (id: string) => setActiveFilter(current => current === id ? undefined : id)
  const updatedAt = version.data?.updatedAt ?? feed.data?.updatedAt
  const newer = !!(version.data && feed.data && version.data.version !== feed.data.version)

  if (unavailable) return <div className="intel-app"><Brand /><section className="intel-main"><div className="intel-empty"><h1>该主题暂未开放</h1><p>本站目前仅提供建筑资讯。其他主题已暂停，后续按需恢复。</p><a className="intel-button" href="/?topic=building">返回建筑情报</a></div></section></div>
  return <div className="intel-app"><Brand /><div className="intel-workspace">
    <aside className="intel-sidebar"><h2>建筑</h2><p>二级栏目</p><nav aria-label="建筑栏目"><button className={!filters.category ? "is-active" : ""} type="button" onClick={() => patch({ category: "" })}><span>全部信息</span><small>{articles.length}</small></button>{Object.entries(categories).map(([id, name]) => <button type="button" key={id} className={filters.category === id ? "is-active" : ""} onClick={() => patch({ category: id })}><span>{name}</span><small>{counts[id]}</small></button>)}</nav><div className="intel-sidebar-note">一条信息可关联多个栏目，“全部信息”去重展示。</div></aside>
    <section className="intel-main"><div className="intel-heading"><div><span className="intel-eyebrow">建筑 / {filters.category ? categories[filters.category] : "全部信息"}</span><h1>{filters.category ? categories[filters.category] : "建筑情报"}</h1><p>官方原文与公开来源，按栏目整理的建筑资讯。</p></div><div className="intel-actions"><button type="button" className="intel-button" aria-expanded={showSources} onClick={() => setShowSources(!showSources)}><Icon kind="sources" />信息源 <small>{sources.length}</small></button><button type="button" className="intel-button intel-primary" disabled={feed.isFetching} onClick={() => void refresh()}><Icon kind="refresh" />{feed.isFetching ? "读取中" : "刷新"}</button></div></div>
      {showSources && <SourcePanel sources={sources} />}
      <div className="intel-controls"><form className="intel-search" onSubmit={event => event.preventDefault()} role="search"><Icon kind="search" /><input type="search" aria-label="搜索当前栏目及筛选条件内的信息" placeholder="在当前栏目与筛选条件内搜索标题、摘要、文号…" maxLength={200} value={filters.q} onChange={event => patch({ q: event.target.value })} /><kbd>当前范围</kbd></form>
        <div className="intel-filter-row"><LocationFilter groups={locationGroups} regions={filters.regions} cities={filters.cities} open={activeFilter === "location"} onToggle={() => toggle("location")} onChange={(regions, cities) => patch({ regions, cities })} /><MultiFilter title="类型" options={intelligenceContentTypes.map(type => ({ id: type, name: type }))} value={filters.types} open={activeFilter === "types"} onToggle={() => toggle("types")} onChange={types => patch({ types })} /><MultiFilter title="来源" options={sourceOptions} value={filters.sources} open={activeFilter === "sources"} onToggle={() => toggle("sources")} onChange={sources => patch({ sources })} /><label className="intel-select"><span>时间</span><select aria-label="发布时间" value={filters.days} onChange={event => patch({ days: Number(event.target.value) })}><option value="0">不限时间</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option><option value="365">最近一年</option></select></label><label className="intel-select"><span>重要度</span><select aria-label="重要度" value={filters.importance} onChange={event => patch({ importance: Number(event.target.value) })}><option value="0">全部</option><option value="60">值得关注及以上</option><option value="80">重点关注</option></select></label><MultiFilter title="标签" options={tags} value={filters.tags} open={activeFilter === "tags"} onToggle={() => toggle("tags")} onChange={tags => patch({ tags })} /></div>
        {!!tags.length && <div className="intel-quick-tags"><span>内容标签</span>{tags.slice(0, 8).map(tag => <button type="button" key={tag.id} className={filters.tags.includes(tag.id) ? "is-active" : ""} onClick={() => patch({ tags: filters.tags.includes(tag.id) ? filters.tags.filter(value => value !== tag.id) : [...filters.tags, tag.id] })}>{tag.name}</button>)}</div>}
        {(selected.length > 0 || filters.days > 0 || filters.importance > 0 || filters.q) && <div className="intel-selected"><span>已选</span>{selected.map(item => <button type="button" key={`${item.key}:${item.value}`} onClick={() => patch({ [item.key]: filters[item.key].filter(value => value !== item.value) })}>{item.label}<span aria-label="移除">×</span></button>)}{filters.days > 0 && <button type="button" onClick={() => patch({ days: 0 })}>最近 {filters.days} 天 ×</button>}{filters.importance > 0 && <button type="button" onClick={() => patch({ importance: 0 })}>{filters.importance === 80 ? "重点关注" : "值得关注及以上"} ×</button>}{filters.q && <button type="button" onClick={() => patch({ q: "" })}>搜索：{filters.q} ×</button>}<button type="button" className="intel-text-button" onClick={reset}>清除筛选</button></div>}
      </div>
      <div className="intel-results-bar"><p><strong>{filtered.length}</strong> 条信息 <span> / 已发布 {articles.length} 条</span></p><label>排序 <select aria-label="结果排序" value={filters.sort} onChange={event => patch({ sort: event.target.value as IntelligenceFilters["sort"] })}><option value="latest">最新发布</option><option value="recommended">推荐</option><option value="importance">重要度</option></select></label></div>
      <div className="intel-sync-status" role="status"><span>最近成功发布：{updatedAt ? new Date(updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "待确认"}</span>{version.isError && <span>暂时无法检查更新，保留当前内容。</span>}{newer && <button type="button" className="intel-text-button" disabled={feed.isFetching} onClick={() => void refresh()}>有新资讯，点击更新</button>}</div>
      {feed.isError && <div className="intel-warning" role="alert">{feed.error.message}{articles.length > 0 && "，当前保留上次读取的内容。"}</div>}
      {feed.data?.truncated && <div className="intel-warning">当前检索范围为最近入库的最多 5,000 条，更早内容暂未纳入。</div>}
      {(!ready || feed.isFetching) && !articles.length && <div className="intel-empty">正在读取建筑资讯…</div>}
      {ready && !feed.isFetching && !feed.isError && !filtered.length && <div className="intel-empty"><h2>{articles.length ? "当前条件下没有结果" : "暂无已发布资讯"}</h2><p>{articles.length ? "可减少筛选条件或清除搜索词；发布日期未核实的内容不出现在限定日期的结果中。" : "后台尚未发布可展示的建筑资讯，请稍后刷新。"}</p>{articles.length > 0 && <button type="button" className="intel-button" onClick={reset}>清除筛选</button>}</div>}
      <div className="intel-feed">{filtered.slice(0, visible).map(article => <ArticleCard key={article.key} article={article} />)}</div>
      {filtered.length > visible && <button type="button" className="intel-load-more" onClick={() => setVisible(value => value + 40)}>显示更多（还有 {filtered.length - visible} 条）</button>}
      <p className="intel-disclaimer">筛选中的地区指发布机构所在地，不等同于政策适用范围。发布日期不明的内容保持未提供；摘要与分类由 AI 辅助生成，具体条款以原文为准。</p>
    </section>
  </div></div>
}
