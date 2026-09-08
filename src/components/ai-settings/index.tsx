import { useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { aiPresets, type AIPublicProfile, type AISettingsView } from "@shared/ai-settings"
import "~/styles/ai-settings.css"

type Draft = AIPublicProfile & { apiKey: string }
export function AISettings() {
  const dialog = useRef<HTMLDialogElement>(null)
  const queries = useQueryClient()
  const [token, setToken] = useState("")
  const [settings, setSettings] = useState<AISettingsView>()
  const [profiles, setProfiles] = useState<Draft[]>([])
  const [activeId, setActiveId] = useState("")
  const [preset, setPreset] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")
  const [catalogs, setCatalogs] = useState<Record<string, string[]>>({})
  const [tests, setTests] = useState<Record<string, string>>({})
  const [current, setCurrent] = useState("")
  async function api<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`/api/intelligence/ai/${path}`, { method: body === undefined ? "GET" : "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", "x-ai-admin-token": token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(85000) })
    const value = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(value.message || value.statusMessage || `请求失败（HTTP ${response.status}）`)
    return value as T
  }
  async function perform(fn: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("")
    try { await fn() } catch (e: any) { setError(e?.name === "TimeoutError" ? "请求超时；没有自动重试。" : e.message || "请求失败") }
    finally { setBusy(false) }
  }
  function accept(data: AISettingsView) {
    setSettings(data); setActiveId(data.activeId); setProfiles(data.profiles.map(p => ({ ...p, apiKey: "" }))); setDirty(false)
  }
  function reset() {
    setToken(""); setSettings(undefined); setProfiles([]); setCatalogs({}); setTests({}); setDirty(false); setError(""); setNotice(""); setCurrent("")
  }
  function edit(id: string, patch: Partial<Draft>) {
    setProfiles(list => list.map(p => p.id === id ? { ...p, ...patch } : p)); setDirty(true); setTests({})
  }
  async function open() {
    dialog.current?.showModal()
    try {
      const response = await fetch("/api/intelligence/ai/status", { cache: "no-store", signal: AbortSignal.timeout(10000) })
      if (!response.ok) return
      const value = await response.json()
      setCurrent(`${value.provider} / ${value.model}${value.enabled ? "（已配置，非实测状态）" : "（不可用）"}`)
    } catch { setCurrent("当前配置状态读取失败") }
  }
  return <>
    <button type="button" className="ai-settings-launch" onClick={open} aria-haspopup="dialog">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M4 7h16M4 17h16" /><circle cx="8" cy="7" r="3" /><circle cx="16" cy="17" r="3" /></svg>AI 设置
    </button>
    <dialog ref={dialog} className="ai-settings-dialog" aria-labelledby="ai-settings-title" onClose={reset} onCancel={e => { if (busy) e.preventDefault() }}>
      <div className="ai-settings-heading"><div><h2 id="ai-settings-title">AI 接入与切换</h2><p>订阅执行节点与独立计费 API 分开配置。</p></div><button type="button" disabled={busy} onClick={() => dialog.current?.close()}>关闭</button></div>
      <div className="ai-settings-body">
        {current && <p className="ai-settings-note">当前服务端：{current}</p>}
        <p className="ai-settings-note">ChatGPT 订阅通过已登录的 Codex 节点执行；Grok 订阅通过已授权的 OpenCode 节点执行。此处不接收账号密码、Cookie 或 OAuth 登录令牌。节点须在线并可通过 HTTPS 访问。</p>
        {!settings ? <form onSubmit={e => { e.preventDefault(); void perform(async () => accept(await api<AISettingsView>("settings"))) }}>
          <label>AI 管理口令<input type="password" autoComplete="off" required value={token} onChange={e => setToken(e.target.value)} placeholder="输入本站的管理口令，不是 AI API Key" /></label>
          <button type="submit" className="ai-settings-primary" disabled={busy || !token}>解锁设置</button>
          <details><summary>首次启用设置</summary><p>在 Cloudflare Pages 的 Production 中添加两个不同的 Secret：AI_ADMIN_TOKEN（本站管理口令）、AI_SETTINGS_ENCRYPTION_KEY（数据库加密主密钥），各至少32字符。首次添加后重新部署；之后在本页保存配置无需重新部署。</p><p>自建节点和其他 API 域名还须加入 AI_ALLOWED_HOSTS，使用逗号分隔的精确域名。不要将上述 Secret 写入 Git。</p></details>
        </form> : <>
          <label>当前使用的 AI<select value={activeId} disabled={busy} onChange={e => { setActiveId(e.target.value); setDirty(true) }}><option value="">沿用部署环境配置（保留现有 Proma / Cloudflare 设置）</option>{profiles.map(p => <option key={p.id} value={p.id}>{p.name} · {p.model}</option>)}</select></label>
          <p className="ai-settings-note">更改后点击“保存并应用”。所有主题的后续请求共用此选择；不重跑已入库文章，不自动切换到其他付费提供方。</p>
          <div className="ai-settings-add"><select aria-label="新增接入类型" value={preset} disabled={busy} onChange={e => setPreset(Number(e.target.value))}>{aiPresets.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}</select><button type="button" disabled={busy || profiles.length >= 12} onClick={() => {
            const p = aiPresets[preset]
            setProfiles(list => [...list, { id: crypto.randomUUID(), name: p.name, kind: p.kind, baseUrl: p.baseUrl, model: p.model ?? "", protocol: p.protocol, authHeader: p.authHeader ?? "bearer", reasoning: "", timeoutSeconds: 60, hasKey: false, apiKey: "" }]); setDirty(true)
          }}>添加配置</button></div>
          {profiles.map(p => <details key={p.id} className="ai-profile-card" open>
            <summary>{p.name || "未命名配置"}<span>{p.id === activeId ? "待应用 / 当前选择" : "备用配置"}</span></summary>
            <fieldset disabled={busy}><div className="ai-settings-grid">
              <label>配置名称<input value={p.name} maxLength={80} onChange={e => edit(p.id, { name: e.target.value })} /></label>
              <label>模型 ID<input list={`models-${p.id}`} value={p.model} maxLength={160} placeholder="按供应商或执行节点提供的 ID 填写" onChange={e => edit(p.id, { model: e.target.value })} /><datalist id={`models-${p.id}`}>{(catalogs[p.id] ?? []).map(model => <option key={model} value={model} />)}</datalist></label>
              {p.kind !== "cloudflare" && <>
                <label className="ai-settings-wide">接口根地址<input type="url" value={p.baseUrl} placeholder="https://你的节点域名/v1" onChange={e => edit(p.id, { baseUrl: e.target.value })} /></label>
                <label>协议<select disabled={p.kind !== "api"} value={p.protocol} onChange={e => edit(p.id, { protocol: e.target.value as Draft["protocol"] })}><option value="chat-completions">Chat Completions</option><option value="responses">Responses</option><option value="messages">Messages</option></select></label>
                <label>认证方式<select value={p.authHeader} onChange={e => edit(p.id, { authHeader: e.target.value as Draft["authHeader"] })}><option value="bearer">Bearer Key</option><option value="x-api-key">x-api-key</option></select></label>
                <label className="ai-settings-wide">{p.kind === "api" ? "API Key" : "节点网关密钥（不是订阅登录令牌）"}<input type="password" autoComplete="new-password" value={p.apiKey} placeholder={p.hasKey ? "已加密保存；留空保留。更换地址后必须重新输入。" : "首次保存必填"} onChange={e => edit(p.id, { apiKey: e.target.value })} /></label>
              </>}
              <label>请求超时（秒）<input type="number" min={10} max={75} value={p.timeoutSeconds} onChange={e => edit(p.id, { timeoutSeconds: Number(e.target.value) })} /></label>
              <label>推理参数<select value={p.reasoning} disabled={p.protocol === "messages" || p.kind !== "api"} onChange={e => edit(p.id, { reasoning: e.target.value as Draft["reasoning"] })}><option value="">不发送（兼容优先）</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option></select></label>
            </div></fieldset>
            <div className="ai-settings-actions">
              <button type="button" disabled={busy || dirty} onClick={() => void perform(async () => {
                const result = await api<{ models: string[] }>("models", { id: p.id }); setCatalogs(c => ({ ...c, [p.id]: result.models })); setNotice(`已读取 ${result.models.length} 个模型 ID；可在模型输入框中选择。`)
              })}>读取模型列表</button>
              <button type="button" disabled={busy || dirty} onClick={() => void perform(async () => {
                const result = await api<{ elapsedMs: number, model: string }>("test", { id: p.id }); setTests(t => ({ ...t, [p.id]: `JSON 测试通过 · ${result.model} · ${(result.elapsedMs / 1000).toFixed(1)} 秒` }))
              })}>测试连接（消耗一次额度）</button>
              <button type="button" disabled={busy} onClick={() => { setProfiles(list => list.filter(x => x.id !== p.id)); if (activeId === p.id) setActiveId(""); setDirty(true) }}>移除此配置</button>
            </div>
            {tests[p.id] && <p className="ai-settings-success">{tests[p.id]}</p>}
          </details>)}
          <div className="ai-settings-save"><button type="button" className="ai-settings-primary" disabled={busy || !dirty} onClick={() => void perform(async () => {
            const saved = await api<AISettingsView>("settings", { revision: settings.revision, activeId, profiles }); accept(saved); setNotice("已持久保存并应用。后续请求使用新配置；已发出的请求不受影响。"); await queries.invalidateQueries({ queryKey: ["intelligence-ai-configuration"] }); await queries.invalidateQueries({ queryKey: ["intelligence"] }); setCurrent("")
          })}>保存并应用</button><button type="button" disabled={busy} onClick={() => void perform(async () => { accept(await api<AISettingsView>("settings")); setTests({}) })}>重新加载（放弃未保存修改）</button><span>{dirty ? "有未保存修改；保存后才能测试" : `已保存 · 版本 ${settings.revision}`}</span></div>
        </>}
        {busy && <p role="status">正在处理当前请求；不会重复发起调用。</p>}
        {notice && <p role="status" className="ai-settings-success">{notice}</p>}
        {error && <p role="alert" className="ai-settings-error">{error}</p>}
        <p className="ai-settings-note">管理口令只在本次打开的面板内存中保留，关闭即清除。服务端不返回已保存的密钥。连接测试不代表批量分类质量或订阅剩余额度。</p>
      </div>
    </dialog>
  </>
}
