// Real Chrome against the production client, using only synthetic in-memory attachments.
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { extname, resolve } from "node:path"
import { makeFixtures } from "./attachment-preview-fixtures.mjs"

const fixtures = makeFixtures(), relayRequests = [], downloads = [], leaks = [], exceptions = []
const fixtureUrl = key => `https://preview.gov.cn/download?id=${key}`
const article = { key: "preview-fixture", topic: "building", title: "附件预览自动验收", url: "https://preview.gov.cn/article", sourceId: "preview", sourceName: "自动测试来源", sourceGroup: "住建官方", sourceLevel: "省级", region: "测试", city: "", column: "通知公告", collectedAt: Date.now(), category: "policy", relatedCategories: [], tags: [], contentType: "通知公告", importance: 80, summary: "这些附件均在内存中生成，不含真实政府文件。", evidence: "title", model: "test", analysisVersion: "test", attachments: Object.entries(fixtures).map(([key, value]) => ({ url: fixtureUrl(key), title: value.filename })) }
const root = resolve("dist/output/public")
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost")
    if (url.pathname === "/api/intelligence/attachment") {
      let json = ""; for await (const chunk of req) json += chunk
      const body = JSON.parse(json); relayRequests.push(body)
      assert.deepEqual(Object.keys(body).sort(), ["articleKey", "topic", "url"])
      assert.equal(body.articleKey, article.key)
      const key = new URL(body.url).searchParams.get("id"), file = fixtures[key]
      assert(file)
      res.writeHead(200, { "Content-Type": file.mime, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`, "Cache-Control": "no-store" }); res.end(file.bytes); return
    }
    if (url.pathname.startsWith("/api/")) {
      const data = url.pathname === "/api/intelligence" ? { pipeline: "mac", articles: [article], sources: [], states: [], aiEnabled: false, generatedAt: Date.now() } : { enable: false }
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); return
    }
    const path = resolve(root, `.${url.pathname === "/" ? "/index.html" : url.pathname}`)
    if (!path.startsWith(root + "/")) { res.writeHead(403).end(); return }
    let bytes
    try { bytes = await readFile(path) } catch { res.writeHead(404).end(); return }
    const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon" }[extname(path)] ?? "application/octet-stream"
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" }); res.end(bytes)
  } catch (error) { console.error(error); res.writeHead(500).end() }
})
await new Promise(resolve => server.listen(4173, "127.0.0.1", resolve))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const target = await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }) })
let seq = 0
const pending = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 30000)
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
}
ws.addEventListener("message", async event => {
  const message = JSON.parse(String(event.data)), task = pending.get(message.id)
  if (task) { pending.delete(message.id); clearTimeout(task.timer); if (message.error) task.reject(new Error(JSON.stringify(message.error))); else task.resolve(message.result); return }
  if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  if (message.method === "Page.downloadWillBegin") downloads.push(message.params.url)
  if (message.method === "Network.requestWillBeSent" && message.params.request.url.includes("leak.example.com")) leaks.push(message.params.request.url)
  if (message.method === "Fetch.requestPaused") {
    const { requestId, request } = message.params
    try {
      const key = new URL(request.url).searchParams.get("id"), file = fixtures[key]
      if (!file) { await send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }); return }
      // DOCX and text permit direct reads; legacy DOC and the remaining fixtures force the CORS fallback.
      const headers = [{ name: "Content-Type", value: file.mime }, { name: "Content-Disposition", value: `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}` }]
      if (["docx", "text"].includes(key)) headers.push({ name: "Access-Control-Allow-Origin", value: "*" }, { name: "Access-Control-Expose-Headers", value: "Content-Disposition" })
      await send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: headers, body: file.bytes.toString("base64") })
    } catch (error) { exceptions.push(String(error)) }
  }
})
const evaluate = async expression => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
  return r.result.value
}
async function until(expression, label) {
  for (let i = 0; i < 120; i++) { if (await evaluate(expression)) return; await sleep(250) }
  throw new Error(`Timed out: ${label}\n${await evaluate("document.body.innerText")}`)
}
async function open(key) {
  const filename = fixtures[key].filename
  await evaluate(`document.querySelector('.intel-original-attachments').open=true; [...document.querySelectorAll('.intel-preview-open')].find(b=>b.textContent.includes(${JSON.stringify(filename)})).click()`)
  await until("!!document.querySelector('dialog[open]')", "dialog open")
}
async function close() {
  await evaluate("document.querySelector('[aria-label=\"关闭附件预览\"]').click()")
  await until("!document.querySelector('dialog')", "dialog closed")
}
await mkdir("attachment-test-results", { recursive: true })
try {
  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable")
  await send("Fetch.enable", { patterns: [{ urlPattern: "https://preview.gov.cn/*", requestStage: "Request" }] })
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__revoked=[];const revoke=URL.revokeObjectURL;URL.revokeObjectURL=function(v){window.__revoked.push(v);return revoke.call(this,v)}" })
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send("Page.navigate", { url: "http://127.0.0.1:4173/" })
  await until("document.body.innerText.includes('附件预览自动验收')", "workspace hydration")
  assert.equal(relayRequests.length, 0, "no attachment prefetch")
  await open("doc")
  await until("document.querySelector('iframe[title=\"附件阅读预览\"]')?.srcdoc.includes('测试工程')", "binary DOC in worker")
  const html = await evaluate("document.querySelector('iframe').srcdoc")
  assert(html.includes("<table>")); assert(html.includes("智能建造附件预览"))
  assert.equal(await evaluate("document.querySelector('iframe').getAttribute('sandbox')"), "")
  assert.equal(relayRequests.length, 1, "CORS fallback uses metadata-only POST")
  await evaluate("(()=>{const input=document.querySelector('dialog input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'项目名称');input.dispatchEvent(new Event('input',{bubbles:true}))})()")
  await until("document.querySelector('iframe').srcdoc.includes('<mark>项目名称</mark>')", "document search")
  await writeFile("attachment-test-results/doc-desktop.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"))
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 })
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 })
  await until("!document.querySelector('dialog')", "Escape closes preview")
  assert.equal(await evaluate("document.documentElement.style.overflow"), "")
  for (const key of ["docx", "text"]) {
    const before = relayRequests.length
    await open(key)
    await until("!!document.querySelector('iframe[srcdoc]')", `${key} preview`)
    assert.equal(relayRequests.length, before, "CORS-enabled origin should read directly")
    assert((await evaluate("document.querySelector('iframe').srcdoc")).includes(key === "docx" ? "DOCX 预览测试" : "中文文本预览"))
    await close()
  }
  await open("html")
  await until("!!document.querySelector('iframe[srcdoc]')", "Word HTML sandbox")
  assert(!(await evaluate("document.querySelector('iframe').srcdoc")).includes("<script>"))
  await sleep(300)
  assert.equal(leaks.length, 0, "no external document resource requests")
  assert.equal(await evaluate("Boolean(window.hacked)"), false)
  await close()
  for (const key of ["bad", "rtf"]) {
    await open(key)
    await until("document.querySelector('dialog')?.innerText.includes('无法在线预览')", `${key} truthful error`)
    assert(await evaluate("!!document.querySelector('dialog a.intel-preview-primary')"))
    await close()
  }
  for (const key of ["pdf", "image"]) {
    await open(key)
    await until(key === "pdf" ? "document.querySelector('iframe')?.src.startsWith('blob:')" : "document.querySelector('.intel-preview-image img')?.src.startsWith('blob:')", `${key} blob preview`)
    const blob = await evaluate(key === "pdf" ? "document.querySelector('iframe').src" : "document.querySelector('.intel-preview-image img').src")
    await close()
    assert(await evaluate(`window.__revoked.includes(${JSON.stringify(blob)})`), "blob URL revoked on close")
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await open("doc")
  await until("!!document.querySelector('iframe[srcdoc]')", "mobile DOC preview")
  assert(await evaluate("document.querySelector('dialog').getBoundingClientRect().width <= 390"))
  await writeFile("attachment-test-results/doc-mobile.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"))
  await close()
  assert.equal(downloads.length, 0, "preview must not trigger browser downloads")
  assert.equal(exceptions.length, 0, exceptions.join("\n"))
  const report = { result: "pass", cases: ["no prefetch", "binary Chinese DOC", "table structure", "CORS relay", "DOCX direct", "text direct", "search", "sandbox", "no external resources", "error fallback", "PDF blob", "image blob", "blob cleanup", "Escape", "mobile", "no downloads"], relayRequests: relayRequests.length, downloads, leaks, exceptions }
  await writeFile("attachment-test-results/report.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} catch (error) {
  await writeFile("attachment-test-results/failure.txt", String(error) + "\n" + exceptions.join("\n"))
  await writeFile("attachment-test-results/failure.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"))
  throw error
} finally { ws.close(); server.closeAllConnections(); server.close() }
