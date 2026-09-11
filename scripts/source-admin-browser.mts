import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdir, writeFile } from "node:fs/promises"
import { sourceAdminPage } from "../server/source-admin/page"
import { sourceAdminSeed, memorySourceDatabase, successfulSourceTest } from "../test/fixtures/source-admin-contract-cases"
import { sourceAdminModel, saveSourceDraft, saveSourceTest, publishSourceDraft, rollbackSourceConfig } from "../server/utils/source-config-store"

// Browser executes the actual shipped HTML and real config store. Authentication and
// upstream parsing are covered by separate unit tests; this server has no credentials.
const fixture = memorySourceDatabase(), requests: string[] = [], errors: string[] = []
const owner = "synthetic-owner@example.com"
fixture.sqlite.exec("CREATE TABLE building_sources_v3 (id TEXT, data TEXT, checked_at INTEGER)")
fixture.sqlite.prepare("INSERT INTO building_sources_v3 VALUES (?,?,?)").run(sourceAdminSeed.id, JSON.stringify({ status: "partial", error: "<img src=x onerror=alert(1)> synthetic", fetched: 3 }), Date.now())
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url!, "http://localhost")
    if (url.pathname === "/internal/sources") {
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-store", "content-security-policy": "default-src 'self'; script-src 'nonce-synthetic'; style-src 'unsafe-inline'; connect-src 'self'" }).end(sourceAdminPage(owner, "synthetic")); return
    }
    if (url.pathname !== "/internal/api/sources") { res.writeHead(404).end(); return }
    requests.push(req.method!)
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(await sourceAdminModel(fixture.event, url.searchParams.get("topic")!))); return
    }
    let json = ""
    for await (const chunk of req) json += chunk
    const body = JSON.parse(json)
    let result: unknown
    if (body.action === "save-draft") result = await saveSourceDraft(fixture.event, body.topic, body.sourceId, body.config, owner, body.base)
    else if (body.action === "test") {
      const draft = await saveSourceDraft(fixture.event, body.topic, body.sourceId, body.config, owner, body.base)
      const now = Date.now(), test = successfulSourceTest(draft.config as any)
      const saved = await saveSourceTest(fixture.event, body.topic, body.sourceId, draft.config, test, owner, { draftHash: draft.hash, activeRevision: draft.activeRevision }, now)
      result = { ...draft, ...saved, result: test }
    }
    else if (body.action === "publish") result = await publishSourceDraft(fixture.event, body.topic, body.sourceId, body.hash, owner, body.base.activeRevision, body.testedAt)
    else if (body.action === "rollback") result = await rollbackSourceConfig(fixture.event, body.topic, body.sourceId, body.revision, owner, body.base)
    else throw new Error("Unknown action")
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result))
  }
  catch (error) { res.writeHead(Number((error as { statusCode?: number }).statusCode ?? 500), { "content-type": "application/json" }).end(JSON.stringify({ message: String((error as Error).message) })) }
})
await new Promise<void>(resolve => server.listen(4187, "127.0.0.1", resolve))
const target = await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json() as { webSocketDebuggerUrl: string }
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }) })
let sequence = 0
const pending = new Map<number, { resolve: (value: any) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>()
function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
}
ws.addEventListener("message", event => {
  const data = JSON.parse(String(event.data)), task = pending.get(data.id)
  if (task) { clearTimeout(task.timer); pending.delete(data.id); if (data.error) task.reject(new Error(JSON.stringify(data.error))); else task.resolve(data.result) }
  if (data.method === "Runtime.exceptionThrown") errors.push(data.params.exceptionDetails.exception?.description ?? data.params.exceptionDetails.text)
  if (data.method === "Page.javascriptDialogOpening") void send("Page.handleJavaScriptDialog", { accept: true })
})
async function evaluate(expression: string) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function until(expression: string) {
  for (let n = 0; n < 80; n++) { if (await evaluate(expression)) return; await sleep(75) }
  throw new Error(`Browser condition failed: ${expression}\n${await evaluate("document.body.innerText")}`)
}
const click = (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
async function input(selector: string, value: string) { await evaluate(`{const input=document.querySelector(${JSON.stringify(selector)}); input.value=${JSON.stringify(value)};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));}`) }
const cases: string[] = []
try {
  await send("Runtime.enable"); await send("Page.enable")
  await send("Emulation.setDeviceMetricsOverride", { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send("Page.navigate", { url: "http://127.0.0.1:4187/internal/sources" })
  await until("document.querySelectorAll('[data-edit]').length===54")
  assert.equal(await evaluate("document.querySelectorAll('[data-topic]').length"), 4)
  assert.equal(await evaluate("document.querySelector('#rows img')"), null)
  assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'intelligence_source_config_%'").get()!.n, 0)
  cases.push("topic layout, escaped health and no DDL on first GET")
  await click('[data-topic="health"]'); await until("document.querySelector('#title').textContent==='健康信息源'")
  assert.equal(await evaluate("document.querySelectorAll('[data-edit]').length"), 8)
  await click('[data-topic="building"]'); await until("document.querySelectorAll('[data-edit]').length===54")
  await input('#search', '北京'); assert.equal(await evaluate("document.querySelectorAll('[data-edit]').length"), 1)
  cases.push("topic isolation and filtering")
  await click(`[data-edit="${sourceAdminSeed.id}"]`)
  await input('#f-mode', 'explicit'); await click('#addEndpoint')
  await input('[data-name]', '合成测试栏目'); await input('[data-url]', `${sourceAdminSeed.home}synthetic-notices/`)
  await click('#save'); await until("!state.busy && !state.dirty")
  assert.equal(await evaluate("document.querySelector('#publish').disabled"), true)
  await click('#test'); await until("!state.busy && !!state.test?.result?.publishable")
  await input('#f-name', '北京市合成修改'); assert.equal(await evaluate("document.querySelector('#publish').disabled"), true)
  const before = requests.length
  await click('#publish'); assert.equal(requests.length, before)
  cases.push("saving draft, testing and edit invalidation")
  await click('#test'); await until("!state.busy && !!state.test?.result?.publishable")
  await click('#publish'); await until("!state.busy && !document.querySelector('#drawer').classList.contains('open')")
  assert.equal(fixture.count('intelligence_source_config_revision'), 1)
  cases.push("actual atomic publish from browser")
  await click(`[data-edit="${sourceAdminSeed.id}"]`); await input('#f-name', '北京市合成第二版本')
  await click('#test'); await until("!state.busy && !!state.test?.result?.publishable")
  await click('#publish'); await until("!state.busy && !document.querySelector('#drawer').classList.contains('open')")
  assert.equal(fixture.count('intelligence_source_config_revision'), 2)
  await click(`[data-edit="${sourceAdminSeed.id}"]`); await click('[data-rollback="1"]'); await until("!state.busy && document.querySelector('#f-name').value==='北京市合成修改'")
  assert.equal(fixture.count('intelligence_source_config_revision'), 2)
  assert.equal(fixture.sqlite.prepare('SELECT active_revision FROM intelligence_source_config_entry').get()!.active_revision, 2)
  cases.push("history restores draft without changing active revision")
  await input('#f-name', 'older editor')
  fixture.sqlite.prepare("UPDATE intelligence_source_config_entry SET draft_hash=?").run('f'.repeat(64))
  await click('#save'); await until("!state.busy && document.querySelector('#toast').textContent.includes('变化')")
  assert.equal(fixture.sqlite.prepare('SELECT draft_hash FROM intelligence_source_config_entry').get()!.draft_hash, 'f'.repeat(64))
  cases.push("stale editor reports conflict without overwriting")
  await mkdir('source-admin-test-results', { recursive: true })
  const screenshot = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile('source-admin-test-results/editor.png', Buffer.from(screenshot.data, 'base64'))
  assert.deepEqual(errors, [])
  const report = { result: 'pass', scope: 'actual HTML and real SQLite config store; synthetic parsing and identity; not production Access login', cases, errors, requests: requests.length }
  await writeFile('source-admin-test-results/report.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
}
finally { ws.close(); server.close(); fixture.sqlite.close() }
