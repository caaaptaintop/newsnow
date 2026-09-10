import "./style.css"
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react"
import type { ManagedSourceConfig, SourceEndpointKind } from "@shared/source-config"

const endpointKinds: Array<{ value: SourceEndpointKind, label: string }> = [
  { value: "policy", label: "政策文件" },
  { value: "notice", label: "通知公告" },
  { value: "interpretation", label: "政策解读" },
  { value: "news", label: "工作动态" },
  { value: "standard", label: "标准规范" },
  { value: "other", label: "其他" },
]
const statusLabel: Record<string, string> = {
  ok: "正常", partial: "部分", error: "异常", unknown: "待运行",
  configured: "已配置", unconfigured: "待配置", draft: "有草稿",
}

type IconName = "search" | "edit" | "chevron" | "plus" | "refresh" | "close" | "test"
function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></>,
    edit: <><path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/></>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
    refresh: <><path d="M20 11a8 8 0 1 0 2 5"/><path d="M20 4v7h-7"/></>,
    close: <><path d="m6 6 12 12"/><path d="m18 6-12 12"/></>,
    test: <><path d="M9 3h6"/><path d="M10 3v5l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V3"/><path d="M8 15h8"/></>,
  }
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.statusMessage || data.message || `请求失败（HTTP ${response.status}）`)
  return data
}

function formatTime(value: number | null) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(value)
    : "—"
}

function emptyConfig(topic: string): ManagedSourceConfig {
  return {
    id: `custom-${topic}-${Date.now().toString(36)}`,
    topic: topic as ManagedSourceConfig["topic"],
    name: "",
    home: "https://",
    group: topic === "building" ? "住建官方" : "自定义",
    level: "省级",
    region: "",
    city: "",
    priority: 80,
    enabled: true,
    collectionMode: "explicit",
    endpoints: [],
  }
}

export function SourceAdmin() {
  const [dashboard, setDashboard] = useState<any>(null)
  const [selectedTopic, setSelectedTopic] = useState("building")
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editor, setEditor] = useState<any>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<any>(null)

  const load = async () => {
    setError("")
    try { setDashboard(await request("/api/internal/source-admin")) }
    catch (cause: any) { setError(cause.message) }
  }
  useEffect(() => {
    document.title = "信息源管理中心"
    void load()
  }, [])

  const sources = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return (dashboard?.sources ?? [])
      .filter((item: any) => item.config.topic === selectedTopic)
      .filter((item: any) => !normalized || `${item.config.name} ${item.config.home} ${item.config.region} ${item.config.city}`.toLowerCase().includes(normalized))
      .filter((item: any) => status === "all" || item.health.status === status || item.configurationStatus === status)
  }, [dashboard, selectedTopic, query, status])
  const topic = dashboard?.topics?.find((item: any) => item.id === selectedTopic)

  const openEditor = async (sourceId: string) => {
    setBusy(true)
    setTestResult(null)
    setError("")
    try {
      const detail = await request(`/api/internal/source-admin?sourceId=${encodeURIComponent(sourceId)}`)
      setEditor({ ...detail, working: structuredClone(detail.draft?.config ?? detail.config), note: detail.draft?.note ?? "" })
    } catch (cause: any) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }
  const addSource = () => setEditor({ config: null, draft: null, history: [], publishedVersion: 0, working: emptyConfig(selectedTopic), note: "" })
  const updateWorking = (patch: Partial<ManagedSourceConfig>) => setEditor((current: any) => ({ ...current, working: { ...current.working, ...patch } }))
  const updateEndpoint = (id: string, patch: any) => updateWorking({
    endpoints: editor.working.endpoints.map((endpoint: any) => endpoint.id === id ? { ...endpoint, ...patch } : endpoint),
  })
  const post = async (body: any) => request("/api/internal/source-admin", { method: "POST", body: JSON.stringify(body) })

  const saveDraft = async () => {
    setBusy(true)
    setError("")
    try {
      await post({ action: "save-draft", config: editor.working, baseVersion: editor.publishedVersion, note: editor.note })
      await load()
      await openEditor(editor.working.id)
    } catch (cause: any) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }
  const test = async (endpointId?: string) => {
    setBusy(true)
    setTestResult(null)
    setError("")
    try { setTestResult(await post({ action: "test", config: editor.working, endpointId })) }
    catch (cause: any) { setError(cause.message) }
    finally { setBusy(false) }
  }
  const discover = async () => {
    setBusy(true)
    setError("")
    try {
      const result = await post({ action: "discover", config: { ...editor.working, collectionMode: "legacy-discovery", endpoints: [] } })
      const existing = new Set(editor.working.endpoints.map((item: any) => item.url))
      updateWorking({
        endpoints: [...editor.working.endpoints, ...result.candidates.filter((item: any) => !existing.has(item.url))],
        collectionMode: "explicit",
      })
    } catch (cause: any) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }
  const publish = async () => {
    setBusy(true)
    setError("")
    try {
      await post({ action: "save-draft", config: editor.working, baseVersion: editor.publishedVersion, note: editor.note })
      await post({ action: "publish", sourceId: editor.working.id, baseRevision: dashboard.revision })
      setEditor(null)
      await load()
    } catch (cause: any) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }
  const restore = async (version: number) => {
    setBusy(true)
    setError("")
    try {
      await post({ action: "restore-history", sourceId: editor.working.id, version })
      await load()
      await openEditor(editor.working.id)
    } catch (cause: any) {
      setError(cause.message)
    } finally {
      setBusy(false)
    }
  }

  return <div className="source-admin-shell">
    <aside className="source-admin-sidebar">
      <div className="source-admin-brand"><span className="source-admin-mark">C</span><div><strong>信息源管理</strong><small>内部运维中心</small></div></div>
      <nav aria-label="主题">
        <p>主题</p>
        {(dashboard?.topics ?? []).map((item: any) => <button key={item.id} className={selectedTopic === item.id ? "active" : ""} onClick={() => setSelectedTopic(item.id)}>
          <span>{item.name}</span><b>{item.sourceCount}</b>{!item.publicEnabled && <small>未启用</small>}
        </button>)}
      </nav>
      <div className="source-admin-rule">公开站保持免登录；此页仅用于受保护的内部信息源维护。</div>
    </aside>

    <main className="source-admin-main">
      <header>
        <div><p>当前主题</p><h1>{topic?.name ?? "信息源"}</h1><span>{topic?.sourceCount ?? 0} 个来源 · 配置版本 {dashboard?.revision ?? "—"}</span></div>
        <div className="source-admin-actions">
          <button className="secondary" onClick={() => void load()}><Icon name="refresh"/>刷新</button>
          <button onClick={addSource}><Icon name="plus"/>添加当前主题来源</button>
        </div>
      </header>
      {error && <div className="source-admin-error">{error}</div>}
      {!dashboard && !error && <div className="source-admin-loading">正在读取受保护的信息源配置…</div>}
      {dashboard && <>
        <section className="source-admin-summary">
          <div><span className="dot ok"/><strong>{topic?.counts.ok ?? 0}</strong><small>运行正常</small></div>
          <div><span className="dot partial"/><strong>{topic?.counts.partial ?? 0}</strong><small>部分完成</small></div>
          <div><span className="dot error"/><strong>{topic?.counts.error ?? 0}</strong><small>运行异常</small></div>
          <div><span className="dot unconfigured"/><strong>{topic?.counts.unconfigured ?? 0}</strong><small>待配置栏目</small></div>
        </section>
        <section className="source-admin-toolbar">
          <label><Icon name="search"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索来源、域名或地区"/></label>
          <select value={status} onChange={event => setStatus(event.target.value)}>
            <option value="all">全部状态</option><option value="ok">运行正常</option><option value="partial">部分完成</option>
            <option value="error">运行异常</option><option value="unconfigured">待配置</option><option value="draft">有草稿</option>
          </select>
        </section>
        <section className="source-admin-table-wrap">
          <table>
            <thead><tr><th>来源</th><th>地区 / 层级</th><th>采集栏目</th><th>配置</th><th>运行</th><th>最近成功</th><th>当前问题</th><th>操作</th></tr></thead>
            <tbody>{sources.map((item: any) => <Fragment key={item.config.id}>
              <tr className={expanded === item.config.id ? "expanded" : ""}>
                <td><button className="row-toggle" onClick={() => setExpanded(expanded === item.config.id ? null : item.config.id)}>
                  <span className={expanded === item.config.id ? "rotate" : ""}><Icon name="chevron"/></span>
                  <div><strong>{item.config.name}</strong><small>{new URL(item.config.home).hostname}</small></div>
                </button></td>
                <td><strong>{[item.config.region, item.config.city].filter(Boolean).join(" · ") || "全国"}</strong><small>{item.config.level}</small></td>
                <td><strong>{item.config.endpoints.filter((entry: any) => entry.enabled).length}</strong><small>{item.config.collectionMode === "legacy-discovery" ? "自动发现（待固化）" : item.config.collectionMode === "feed" ? "平台适配器" : "明确栏目"}</small></td>
                <td><span className={`status ${item.configurationStatus}`}>{statusLabel[item.configurationStatus]}</span>{item.hasDraft && <small>未发布修改</small>}</td>
                <td><span className={`status ${item.health.status}`}>{statusLabel[item.health.status] ?? item.health.status}</span><small>{formatTime(item.health.checkedAt)}</small></td>
                <td>{formatTime(item.health.lastSuccessAt)}</td>
                <td className="issue" title={item.health.issue}>{item.health.issue}</td>
                <td><button className="icon-button" onClick={() => void openEditor(item.config.id)} aria-label="编辑"><Icon name="edit"/></button></td>
              </tr>
              {expanded === item.config.id && <tr className="endpoint-row"><td colSpan={8}><div className="endpoint-grid">
                {item.endpoints.length ? item.endpoints.map((endpoint: any) => <div key={endpoint.id}>
                  <span className={`dot ${endpoint.status}`}/><section><strong>{endpoint.name}</strong><small>{endpointKinds.find(kind => kind.value === endpoint.kind)?.label} · {endpoint.url}</small>{endpoint.issue && <em>{endpoint.issue}</em>}</section>
                </div>) : <p>尚未固化采集栏目。请编辑来源并添加正确的目标页面。</p>}
              </div></td></tr>}
            </Fragment>)}</tbody>
          </table>
          {!sources.length && <div className="source-admin-empty">当前筛选条件下没有来源。</div>}
        </section>
      </>}
    </main>

    {editor && <div className="source-admin-overlay" role="dialog" aria-modal="true"><div className="source-admin-drawer">
      <header>
        <div><p>{editor.config ? "编辑来源" : "添加来源"}</p><h2>{editor.working.name || "新信息源"}</h2><span>{editor.working.topic} · 已发布版本 {editor.publishedVersion}</span></div>
        <button className="icon-button" onClick={() => setEditor(null)} aria-label="关闭"><Icon name="close"/></button>
      </header>
      <div className="source-admin-form">
        <h3>基本信息</h3>
        <div className="form-grid">
          <label><span>来源编号</span><input value={editor.working.id} disabled={Boolean(editor.config)} onChange={event => updateWorking({ id: event.target.value })}/></label>
          <label><span>名称</span><input value={editor.working.name} onChange={event => updateWorking({ name: event.target.value })}/></label>
          <label className="wide"><span>官网</span><input value={editor.working.home} onChange={event => updateWorking({ home: event.target.value })}/></label>
          <label><span>地区</span><input value={editor.working.region} onChange={event => updateWorking({ region: event.target.value })}/></label>
          <label><span>城市</span><input value={editor.working.city} onChange={event => updateWorking({ city: event.target.value })}/></label>
          <label><span>层级</span><input value={editor.working.level} onChange={event => updateWorking({ level: event.target.value })}/></label>
          <label><span>优先级</span><input type="number" value={editor.working.priority} onChange={event => updateWorking({ priority: Number(event.target.value) })}/></label>
        </div>

        <div className="section-heading">
          <div><h3>采集栏目</h3><p>明确配置后，生产采集不再从官网首页猜测栏目或回退抓首页。</p></div>
          <button className="secondary" onClick={() => void discover()} disabled={busy}><Icon name="search"/>发现候选栏目</button>
        </div>
        <div className="endpoint-editor">{editor.working.endpoints.map((endpoint: any) => <div key={endpoint.id}>
          <label><span>类型</span><select value={endpoint.kind} onChange={event => updateEndpoint(endpoint.id, { kind: event.target.value })}>{endpointKinds.map(kind => <option key={kind.value} value={kind.value}>{kind.label}</option>)}</select></label>
          <label><span>栏目名称</span><input value={endpoint.name} onChange={event => updateEndpoint(endpoint.id, { name: event.target.value })}/></label>
          <label className="url"><span>栏目 URL</span><input value={endpoint.url} onChange={event => updateEndpoint(endpoint.id, { url: event.target.value })}/></label>
          <button className="icon-button" onClick={() => void test(endpoint.id)} title="测试栏目"><Icon name="test"/></button>
          <button className="icon-button danger" onClick={() => updateWorking({ endpoints: editor.working.endpoints.filter((item: any) => item.id !== endpoint.id) })} title="删除栏目"><Icon name="close"/></button>
        </div>)}</div>
        <button className="dashed" onClick={() => updateWorking({
          endpoints: [...editor.working.endpoints, { id: `column-${Date.now().toString(36)}`, kind: "notice", name: "通知公告", url: editor.working.home, enabled: true }],
          collectionMode: "explicit",
        })}><Icon name="plus"/>添加栏目</button>

        {testResult && <section className="test-result">
          <h3>测试结果</h3>
          <div><strong>{testResult.candidateCount}</strong><span>识别文章</span><strong>{testResult.datedCount}</strong><span>含可靠日期</span><strong>{testResult.sampleAttachments}</strong><span>样本附件</span></div>
          {testResult.warnings?.length > 0 && <p>{testResult.warnings.join("；")}</p>}
          {testResult.samples?.map((sample: any) => <article key={sample.url}><strong>{sample.title}</strong><small>{sample.publishedAt ? formatTime(sample.publishedAt) : "日期待核"} · {sample.attachments.length} 个附件</small></article>)}
        </section>}

        <label className="note"><span>修改说明</span><textarea value={editor.note} onChange={event => setEditor((current: any) => ({ ...current, note: event.target.value }))} placeholder="说明为什么调整栏目或来源"/></label>
        {editor.history?.length > 0 && <section className="history"><h3>发布历史</h3>{editor.history.map((entry: any) => <div key={entry.version}><span>版本 {entry.version}</span><small>{formatTime(entry.publishedAt)} · {entry.note || "无说明"}</small><button className="text-button" onClick={() => void restore(entry.version)}>恢复为草稿</button></div>)}</section>}
      </div>
      <footer>
        <button className="secondary" onClick={() => void test()} disabled={busy}><Icon name="test"/>测试全部</button><span/>
        <button className="secondary" onClick={() => void saveDraft()} disabled={busy}>保存草稿</button>
        <button onClick={() => void publish()} disabled={busy}>发布配置</button>
      </footer>
    </div></div>}
  </div>
}
