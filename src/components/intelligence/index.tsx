import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { intelligenceTopics, intelligenceContentTypes, emptyIntelligenceFilters, intelligenceFilter, intelligenceHttpUrl, type IntelligenceArticle, type IntelligenceFeed, type IntelligenceFilters, type IntelligenceSource, type IntelligenceSourceState, type IntelligenceTopic } from "@shared/intelligence"
import { AttachmentList } from "../attachment-preview"
import { useHealthIntelligence } from "./use-health"
import "~/styles/intelligence.css"

const topicIds = Object.keys(intelligenceTopics) as IntelligenceTopic[]
const stateLabels: Record<IntelligenceSourceState["status"], string> = { pending: "待首次采集", running: "采集中", ok: "采集完成", partial: "部分完成", error: "采集失败" }
function initialView(search = "") {
  const params = new URLSearchParams(search)
  const candidate = params.get("topic") as IntelligenceTopic
  const topic = topicIds.includes(candidate) ? candidate : "building"
  const filters = emptyIntelligenceFilters()
  const category = params.get("category") ?? ""
  if (Object.prototype.hasOwnProperty.call(intelligenceTopics[topic].categories, category)) filters.category = category
  filters.q = (params.get("q") ?? "").slice(0, 200)
  for (const key of ["regions", "cities", "types", "sources", "tags"] as const) filters[key] = params.getAll(key).slice(0, 30)
  const days = Number(params.get("days")); if ([7, 30, 90, 365].includes(days)) filters.days = days
  const importance = Number(params.get("importance")); if ([60, 80].includes(importance)) filters.importance = importance
  const sort = params.get("sort"); if (sort === "recommended" || sort === "latest" || sort === "importance") filters.sort = sort
  else if (topic === "health") filters.sort = "recommended"
  return { topic, filters }
}
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(180000) })
  if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`)
  return response.json() as Promise<T>
}
const displayDate = (value?: number) => value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(value) : "发布日期未提供"
function Icon({ kind }: { kind: "search" | "refresh" | "external" | "sources" }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "search" && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>}
    {kind === "refresh" && <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9" /></>}
    {kind === "external" && <><path d="M14 4h6v6m0-6-9 9M10 5H5v14h14v-5" /></>}
    {kind === "sources" && <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7" /></>}
  </svg>
}
function MultiFilter({ title, options, value, onChange }: { title: string, options: { id: string, name: string }[], value: string[], onChange: (values: string[]) => void }) {
  return <details className="intel-filter">
    <summary>{title}{value.length > 0 && <span className="intel-filter-count">{value.length}</span>}<span className="intel-caret">⌄</span></summary>
    <div className="intel-filter-menu">
      <button type="button" className="intel-text-button" onClick={() => onChange([])}>不限{title}</button>
      {!options.length && <p className="intel-muted">当前没有可用选项</p>}
      {options.map(option => <label key={option.id}><input type="checkbox" checked={value.includes(option.id)} onChange={e => onChange(e.target.checked ? [...value, option.id] : value.filter(v => v !== option.id))} /><span>{option.name}</span></label>)}
    </div>
  </details>
}
function ArticleCard({ article, topic }: { article: IntelligenceArticle, topic: IntelligenceTopic }) {
  const categories: Record<string, string> = intelligenceTopics[topic].categories
  const url = intelligenceHttpUrl(article.url)
  const tags = article.tags ?? []
  return <article className="intel-card">
    <div className="intel-meta"><span className="intel-source-name">{article.sourceName}</span>{article.sourceGroup === "住建官方" && <span className="intel-official">官方</span>}<span>{[article.region, article.city && article.city !== article.region ? article.city : ""].filter(Boolean).join(" / ")}</span><time title={article.publicationDate?.basis === "source_id" ? "根据帖子ID编码提取创建时间" : article.publicationDate?.status === "verified" ? "已核对信息源发布时间" : "信息源发布时间尚未核实"}>{!article.publishedAt && article.publicationDate?.reason !== "not_article" ? "发布日期待核实" : displayDate(article.publishedAt)}</time></div>
    <h2>{url ? <a href={url} target="_blank" rel="noreferrer">{article.title}<Icon kind="external" /></a> : article.title}</h2>
    <p className="intel-summary"><span>{topic === "health" ? "建议切入" : article.evidence === "body" ? "AI 摘要" : "标题概述"}</span>{article.summary}</p>
    {topic === "health" && article.reason && <p className="intel-reason">选题判断：{article.reason}</p>}
    <div className="intel-card-labels"><span>{categories[article.category] ?? article.category}</span><span>{article.contentType}</span>{tags.map(tag => <span key={tag}>{tag}</span>)}</div>
    <div className="intel-card-foot"><span>{article.column}</span>{article.documentNo && <span>{article.documentNo}</span>}<span>{article.evidence === "title" ? "仅依据标题分析" : "依据已提取正文分析"}</span>{topic !== "health" && <span title="AI 编辑排序信号，不代表法定效力或客观评价">{article.importance >= 80 ? "重点关注" : article.importance >= 60 ? "值得关注" : "一般信息"}</span>}</div>
    <AttachmentList article={article} />
    {!!article.otherSources?.length && <details className="intel-attachments"><summary>其他转载来源 {article.otherSources.length} 个</summary>{article.otherSources.map(s => <a key={s.url} href={s.url} target="_blank" rel="noreferrer">{s.name}</a>)}</details>}
  </article>
}
function SourcePanel({ sources, states, busy, onSync, macManaged }: { macManaged?: boolean, sources: IntelligenceSource[], states: IntelligenceSourceState[], busy: boolean, onSync: (id: string) => void }) {
  const byId = new Map(states.map(s => [s.id, s]))
  return <section className="intel-source-panel" aria-label="信息源状态">
    <h2>信息源与采集状态</h2><p className="intel-muted">已配置不等于抓取成功。官网不可达、页面模板不兼容或 AI 失败都会在此列明，已有信息不会因此清空。</p>
    <div className="intel-source-grid">{sources.map(source => {
      const state = byId.get(source.id) ?? { id: source.id, status: "pending" as const }
      return <article key={source.id}><div className="intel-source-row"><a href={source.home} target="_blank" rel="noreferrer">{source.name}</a><span className={`intel-status intel-status-${state.status}`}>{stateLabels[state.status]}</span></div>
        <p>{[source.group, source.region, source.city].filter(Boolean).join(" · ")}</p><p>最近检查：{state.checkedAt ? new Date(state.checkedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "尚未执行"}{state.fetched !== undefined && ` · 候选 ${state.fetched} 条`}{state.accepted !== undefined && ` · 本轮入库 ${state.accepted} 条`}</p>
        {state.error && <p className="intel-source-error">{state.error}</p>}
        {(state.columns ?? source.columns ?? []).map(c => <a className="intel-column-link" href={c.url} target="_blank" rel="noreferrer" key={c.url}>{c.name}</a>)}
        <button type="button" className="intel-text-button" disabled={busy} onClick={() => onSync(source.id)}>{macManaged ? "刷新状态" : "检查此来源"}</button>
      </article>
    })}</div>
  </section>
}
export function IntelligenceWorkspace() {
  const queryClient = useQueryClient()
  // Keep the first server render and the first hydration render identical.
  // URL state is applied after mount, because `window` does not exist during SSR.
  const [view, setView] = useState(() => initialView(""))
  const { topic, filters } = view
  const [showSources, setShowSources] = useState(false)
  const [syncProgress, setSyncProgress] = useState("")
  const [syncError, setSyncError] = useState("")
  const [busy, setBusy] = useState(false)
  const [visible, setVisible] = useState(40)
  const [activeSyncTopic, setActiveSyncTopic] = useState<IntelligenceTopic>()
  const syncLock = useRef(false)
  const bootstrapped = useRef(new Set<string>())
  const feed = useQuery({ queryKey: ["intelligence", topic], queryFn: () => request<IntelligenceFeed>(`/api/intelligence?topic=${topic}`), staleTime: 60000, refetchInterval: 60000, refetchOnWindowFocus: false, retry: false })
  const macManaged = feed.data?.pipeline === "mac"
  const liveHealth = topic === "health" && !macManaged
  const health = useHealthIntelligence(liveHealth && !!feed.data)
  const sourceList = liveHealth ? health.sources : feed.data?.sources ?? []
  const states = liveHealth ? health.states : feed.data?.states ?? []
  const articles = liveHealth ? health.articles : feed.data?.articles ?? []
  const loading = feed.isFetching || (liveHealth && health.loading)
  const error = feed.error?.message ?? (liveHealth ? health.error : undefined)
  const categories: Record<string, string> = intelligenceTopics[topic].categories
  const patchFilters = (patch: Partial<IntelligenceFilters>) => { setView(v => ({ ...v, filters: { ...v.filters, ...patch } })); setVisible(40) }
  const sync = useCallback(async (ids: string[], syncTopic: IntelligenceTopic) => {
    if (macManaged) {
      await queryClient.invalidateQueries({ queryKey: ["intelligence", syncTopic] })
      return
    }
    if (syncLock.current) return
    syncLock.current = true; setBusy(true); setActiveSyncTopic(syncTopic); setSyncError("")
    let cursor = 0, completed = 0, failed = 0
    try {
      await Promise.all(Array.from({ length: Math.min(3, ids.length) }, async () => {
        while (cursor < ids.length) {
          const id = ids[cursor++]
          try { const state = await request<IntelligenceSourceState>("/api/intelligence/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: id }) }); if (state.status === "error") failed++ } catch { failed++ }
          completed++; setSyncProgress(`已检查 ${completed} / ${ids.length} 个来源${failed ? `，${failed} 个未成功` : ""}`)
          await queryClient.invalidateQueries({ queryKey: ["intelligence", syncTopic] })
        }
      }))
      if (failed) setSyncError(`${failed} 个来源未成功，请在“信息源”中查看。未成功来源不等于没有相关信息。`)
    } finally { setBusy(false); syncLock.current = false }
  }, [queryClient, macManaged])
  useEffect(() => {
    const next = initialView(window.location.search)
    setView(next)
  }, [])
  useEffect(() => {
    document.title = `${intelligenceTopics[topic].name} · 个人信息情报站`
    const params = new URLSearchParams(); params.set("topic", topic)
    if (filters.category) params.set("category", filters.category)
    if (filters.q) params.set("q", filters.q)
    for (const key of ["regions", "cities", "types", "sources", "tags"] as const) for (const value of filters[key]) params.append(key, value)
    if (filters.days) params.set("days", String(filters.days))
    if (filters.importance) params.set("importance", String(filters.importance))
    params.set("sort", filters.sort)
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params}`)
  }, [topic, filters])
  useEffect(() => {
    const onPopState = () => setView(initialView(window.location.search))
    window.addEventListener("popstate", onPopState); return () => window.removeEventListener("popstate", onPopState)
  }, [])
  useEffect(() => {
    if (macManaged || topic === "health" || !feed.data?.aiEnabled || busy || bootstrapped.current.has(topic)) return
    const pending = feed.data.sources.filter(s => !feed.data!.states.some(st => st.id === s.id && st.checkedAt))
    if (pending.length && !feed.data.articles.length) {
      bootstrapped.current.add(topic)
      void sync(pending.sort((a, b) => b.priority - a.priority).slice(0, 4).map(s => s.id), topic)
    }
  }, [topic, feed.data, busy, sync, macManaged])
  const selectTopic = (next: IntelligenceTopic) => {
    const filters = emptyIntelligenceFilters(); if (next === "health") filters.sort = "recommended"
    setView({ topic: next, filters }); setVisible(40); setShowSources(false)
  }
  const filtered = useMemo(() => intelligenceFilter(articles, filters), [articles, filters])
  const counts = useMemo(() => Object.fromEntries(Object.keys(categories).map(c => [c, articles.filter(a => a.category === c || (a.relatedCategories ?? []).includes(c)).length])), [articles, categories])
  const opts = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN")).map(v => ({ id: v, name: v }))
  const regionOptions = opts([...sourceList.map(s => s.region), ...articles.map(a => a.region)])
  const cityOptions = opts([...sourceList, ...articles].filter(s => !filters.regions.length || filters.regions.includes(s.region)).map(s => s.city))
  const tags = opts(articles.flatMap(a => a.tags ?? []))
  const sourceOptions = [...opts(sourceList.map(s => s.group)), ...sourceList.map(s => ({ id: s.id, name: s.name }))]
  const labelFor = (key: string, value: string) => key === "sources" ? sourceOptions.find(o => o.id === value)?.name ?? value : value
  const selected = (["regions", "cities", "types", "sources", "tags"] as const).flatMap(key => filters[key].map(value => ({ key, value, label: labelFor(key, value) })))
  const reset = () => patchFilters({ ...emptyIntelligenceFilters(), category: filters.category, sort: topic === "health" ? "recommended" : "latest" })
  const statusSummary = `${states.filter(s => s.status === "ok").length} 完成 · ${states.filter(s => s.status === "partial").length} 部分完成 · ${states.filter(s => s.status === "error").length} 失败 · ${states.filter(s => s.status === "pending").length} 待采集`
  return <div className="intel-app">
    <header className="intel-topbar"><a href="/" className="intel-brand"><span className="intel-brand-mark">情</span><span>个人信息情报站<small>CAPX · INTELLIGENCE</small></span></a><nav aria-label="一级主题">{topicIds.map(id => <button type="button" key={id} aria-current={topic === id ? "page" : undefined} className={topic === id ? "is-active" : ""} onClick={() => selectTopic(id)}>{intelligenceTopics[id].name}</button>)}</nav><a href="/c/hottest" className="intel-legacy-link">原始热榜</a></header>
    <div className="intel-workspace"><aside className="intel-sidebar"><h2>{intelligenceTopics[topic].name}</h2><p>二级栏目</p><nav aria-label="二级栏目"><button className={!filters.category ? "is-active" : ""} type="button" onClick={() => patchFilters({ category: "" })}><span>全部信息</span><small>{articles.length}</small></button>{Object.entries(categories).map(([id, name]) => <button type="button" key={id} className={filters.category === id ? "is-active" : ""} onClick={() => patchFilters({ category: id })}><span>{name}</span><small>{counts[id]}</small></button>)}</nav><div className="intel-sidebar-note">一条信息可关联多个栏目，“全部信息”去重展示。{topic === "health" && "运动健康保留健宁原有八条选题线。"}</div></aside>
    <section className="intel-main"><div className="intel-heading"><div><span className="intel-eyebrow">{intelligenceTopics[topic].name} / {filters.category ? categories[filters.category] : "全部信息"}</span><h1>{filters.category ? categories[filters.category] : topic === "health" ? "健宁热点选题" : `${intelligenceTopics[topic].name}情报`}</h1><p>{topic === "health" ? "保留事实桥梁、八条选题线与建议切入，不用关键词替代选题判断。" : "官方原文与可信来源，经过 AI 分析后按栏目组织。"}</p></div><div className="intel-actions"><button type="button" className="intel-button" aria-expanded={showSources} onClick={() => setShowSources(!showSources)}><Icon kind="sources" />信息源 <small>{sourceList.length}</small></button><button type="button" className="intel-button intel-primary" disabled={busy || (topic === "health" && health.loading) || !sourceList.length} onClick={() => liveHealth ? void health.refresh() : void sync(sourceList.map(s => s.id), topic)}><Icon kind="refresh" />{busy ? "采集中" : macManaged ? "读取最新结果" : "同步信息"}</button></div></div>
      {showSources && <SourcePanel macManaged={macManaged} sources={sourceList} states={states} busy={busy || health.loading} onSync={id => liveHealth ? void health.refresh() : void sync([id], topic)} />}
      <div className="intel-controls"><form className="intel-search" onSubmit={e => e.preventDefault()} role="search"><Icon kind="search" /><input type="search" aria-label="搜索当前栏目及筛选条件内的信息" placeholder="在当前栏目与筛选条件内搜索标题、摘要、文号…" maxLength={200} value={filters.q} onChange={e => patchFilters({ q: e.target.value })} /><kbd>当前范围</kbd></form>
        <div className="intel-filter-row"><MultiFilter title="发布地区" options={regionOptions} value={filters.regions} onChange={regions => { const allowed = [...sourceList, ...articles].filter(s => !regions.length || regions.includes(s.region)).map(s => s.city); patchFilters({ regions, cities: filters.cities.filter(c => allowed.includes(c)) }) }} /><MultiFilter title="发布城市" options={cityOptions} value={filters.cities} onChange={cities => patchFilters({ cities })} /><MultiFilter title="类型" options={intelligenceContentTypes.map(t => ({ id: t, name: t }))} value={filters.types} onChange={types => patchFilters({ types })} /><MultiFilter title="来源" options={sourceOptions} value={filters.sources} onChange={sources => patchFilters({ sources })} /><label className="intel-select"><span>时间</span><select aria-label="发布时间" value={filters.days} onChange={e => patchFilters({ days: Number(e.target.value) })}><option value="0">不限时间</option><option value="7">最近 7 天</option><option value="30">最近 30 天</option><option value="90">最近 90 天</option><option value="365">最近一年</option></select></label>{topic !== "health" && <label className="intel-select"><span>重要度</span><select aria-label="重要度" value={filters.importance} onChange={e => patchFilters({ importance: Number(e.target.value) })}><option value="0">全部</option><option value="60">值得关注及以上</option><option value="80">重点关注</option></select></label>}<MultiFilter title="标签" options={tags} value={filters.tags} onChange={tags => patchFilters({ tags })} /></div>
        {tags.length > 0 && <div className="intel-quick-tags"><span>内容标签</span>{tags.slice(0, 8).map(tag => <button type="button" key={tag.id} className={filters.tags.includes(tag.id) ? "is-active" : ""} onClick={() => patchFilters({ tags: filters.tags.includes(tag.id) ? filters.tags.filter(t => t !== tag.id) : [...filters.tags, tag.id] })}>{tag.name}</button>)}</div>}
        {(selected.length > 0 || filters.days > 0 || filters.importance > 0 || filters.q) && <div className="intel-selected"><span>已选</span>{selected.map(s => <button type="button" key={`${s.key}:${s.value}`} onClick={() => patchFilters({ [s.key]: filters[s.key].filter(v => v !== s.value) })}>{s.label}<span aria-label="移除">×</span></button>)}{filters.days > 0 && <button type="button" onClick={() => patchFilters({ days: 0 })}>最近 {filters.days} 天 ×</button>}{filters.importance > 0 && <button type="button" onClick={() => patchFilters({ importance: 0 })}>{filters.importance === 80 ? "重点关注" : "值得关注及以上"} ×</button>}{filters.q && <button type="button" onClick={() => patchFilters({ q: "" })}>搜索：{filters.q} ×</button>}<button type="button" className="intel-text-button" onClick={reset}>清除筛选</button></div>}
      </div>
      <div className="intel-results-bar"><p><strong>{filtered.length}</strong> 条信息 <span> / 已入库 {articles.length} 条</span></p><label>排序 <select aria-label="结果排序" value={filters.sort} onChange={e => patchFilters({ sort: e.target.value as IntelligenceFilters["sort"] })}><option value="latest">最新发布</option><option value="recommended">推荐</option>{topic !== "health" && <option value="importance">重要度</option>}</select></label></div>
      {macManaged && <p className="intel-muted">Mac 每轮结束后约 15 分钟再检查 · Luna 低推理 · 最近发布：{feed.data?.updatedAt ? new Date(feed.data.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "待首次发布"}。采集、分析和发布需要额外时间；合盖休眠或离线期间暂停，保留已有结果。</p>}
      <div className="intel-sync-status" role="status">{liveHealth ? health.progress || `健宁选题 AI${health.aiEnabled ? "已完成分析" : "待分析"} · ${statusSummary}` : `${sourceList.length} 个来源 · ${statusSummary}`}{activeSyncTopic === topic && syncProgress && <span>{syncProgress}</span>}</div>
      {(error || (activeSyncTopic === topic && syncError)) && <div className="intel-warning" role="alert">{error || syncError}</div>}
      {topic !== "health" && feed.data && !feed.data.aiEnabled && <div className="intel-warning">AI 运行环境不可用。已有信息仍可检索，新内容不会降级为关键词分类。</div>}
      {topic !== "health" && feed.data && !feed.data.persistent && <div className="intel-warning">数据库未连接，当前仅为临时缓存；内容可能随服务重启丢失，不能视为持久入库。</div>}
      {feed.data?.truncated && topic !== "health" && <div className="intel-warning">当前检索范围为最近入库的 5000 条。更早内容未包含在本次筛选中。</div>}
      {loading && !articles.length && <div className="intel-empty">{topic === "health" ? health.progress : "正在读取情报库…"}</div>}
      {!loading && !filtered.length && <div className="intel-empty"><h2>{busy && activeSyncTopic === topic ? "正在采集并分析" : articles.length ? "当前条件下没有结果" : "暂无已入库信息"}</h2><p>{articles.length ? "可减少筛选条件或清除搜索词；未提供发布日期的内容不出现在限定日期的结果中。" : macManaged ? "后台尚未发布此主题的新结果；请查看来源状态，未完成部分将在后续批次继续处理。" : topic === "health" ? "本轮未产生可展示的 AI 选题；请检查信息源与 AI 状态。" : "来源清单已配置。点击“同步信息”执行采集，成功分析后的内容会显示在这里；不会填入演示新闻。"}</p>{articles.length > 0 && <button type="button" className="intel-button" onClick={reset}>清除筛选</button>}</div>}
      <div className="intel-feed">{filtered.slice(0, visible).map(article => <ArticleCard key={article.key} article={article} topic={topic} />)}</div>
      {filtered.length > visible && <button type="button" className="intel-load-more" onClick={() => setVisible(v => v + 40)}>显示更多（还有 {filtered.length - visible} 条）</button>}
      <p className="intel-disclaimer">筛选中的地区与城市指发布机构所在地，不等同于政策适用范围。发布日期不明的内容保持未提供；摘要与分类由 AI 辅助生成，具体条款以原文为准。</p>
    </section></div>
  </div>
}
