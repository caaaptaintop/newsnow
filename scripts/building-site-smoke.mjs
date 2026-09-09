import assert from "node:assert/strict"
import { createServer } from "node:http"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { extname, resolve } from "node:path"
const root = resolve("dist/output/public"), requests = [], exceptions = []
const source = (id, region, city) => ({ id, name: `${city || region}测试来源`, home: `https://${id}.example.gov.cn/`, group: "住建官方", region, city })
const sources = [source("nanjing", "江苏", "南京"), source("suzhou", "江苏", "苏州"), source("hangzhou", "浙江", "杭州")]
const articles = sources.map((source, index) => ({ key: `building:fixture-${index}`, topic: "building", title: `${source.city}建筑测试资讯`, url: `${source.home}article`, sourceId: source.id, sourceName: source.name, sourceGroup: source.group, sourceLevel: "市级", region: source.region, city: source.city, column: "通知公告", collectedAt: Date.now(), publishedAt: Date.now(), publicationDate: { status: "verified" }, category: "intelligent_construction", relatedCategories: [], tags: ["BIM"], contentType: "通知公告", importance: 80, summary: "仅供浏览器交互测试的合成数据。", evidence: "title", attachments: [] }))
const feed = { topic: "building", version: "v1", updatedAt: 1788960000000, articles, sources, truncated: false }
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost")
    if (url.pathname.startsWith("/api/")) {
      requests.push(url.pathname)
      const data = url.pathname === "/api/intelligence" ? feed : url.pathname === "/api/intelligence/version" ? { topic: "building", version: feed.version, updatedAt: feed.updatedAt } : { error: "Unexpected API" }
      res.writeHead(url.pathname === "/api/intelligence" || url.pathname === "/api/intelligence/version" ? 200 : 404, { "Content-Type": "application/json", "Cache-Control": "no-store" }).end(JSON.stringify(data)); return
    }
    const pathname = url.pathname === "/" || url.pathname.startsWith("/c/") ? "/index.html" : url.pathname
    const path = resolve(root, `.${pathname}`)
    if (!path.startsWith(root + "/")) { res.writeHead(403).end(); return }
    const bytes = await readFile(path)
    const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" }[extname(path)] ?? "application/octet-stream"
    res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" }).end(bytes)
  } catch { res.writeHead(404).end() }
})
await new Promise(resolve => server.listen(4174, "127.0.0.1", resolve))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const target = await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }) })
let sequence = 0
const pending = new Map()
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
}
ws.addEventListener("message", event => {
  const message = JSON.parse(String(event.data)), task = pending.get(message.id)
  if (task) { pending.delete(message.id); clearTimeout(task.timer); if (message.error) task.reject(new Error(JSON.stringify(message.error))); else task.resolve(message.result) }
  if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
})
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function until(expression, label) {
  for (let i = 0; i < 60; i++) { if (await evaluate(expression)) return; await sleep(100) }
  throw new Error(`Timed out: ${label}\n${await evaluate("document.body.innerText")}`)
}
const button = name => `[...document.querySelectorAll('.intel-filter-trigger')].find(button => button.textContent.startsWith(${JSON.stringify(name)}))`
async function click(expression) { await evaluate(`(${expression}).click()`); await sleep(80) }
const openMenus = "document.querySelectorAll('.intel-filter-menu').length"
await mkdir("building-test-results", { recursive: true })
try {
  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable")
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__intervals=[];const original=setInterval;window.setInterval=function(fn,ms,...args){window.__intervals.push(ms);return original(fn,ms,...args)}" })
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await send("Page.navigate", { url: "http://127.0.0.1:4174/" })
  await until("document.querySelectorAll('.intel-card').length===3", "building feed")
  assert.equal(await evaluate("!!document.querySelector('[aria-label=一级主题]')"), false)
  assert.equal(await evaluate("document.body.innerText.includes('运动健康') || document.body.innerText.includes('AI 科技') || document.body.innerText.includes('原始热榜')"), false)
  assert.equal(requests.some(path => !["/api/intelligence", "/api/intelligence/version"].includes(path)), false, requests.join(","))
  assert(await evaluate("window.__intervals.includes(300000)"), "five-minute lightweight version polling")
  assert.equal(await evaluate("window.__intervals.includes(60000)"), false, "no old one-minute polling")
  await click(button("发布地区"))
  assert.equal(await evaluate(openMenus), 1)
  assert.equal(await evaluate("document.querySelectorAll('.intel-location-city-options label').length"), 0, "cities not expanded initially")
  await click("[...document.querySelectorAll('.intel-location-region-button')].find(button=>button.textContent.includes('江苏'))")
  assert.equal(await evaluate("document.querySelectorAll('.intel-location-city-options label').length"), 2)
  assert.equal(await evaluate("document.querySelector('.intel-location-city-options').innerText.includes('杭州')"), false)
  await click("[...document.querySelectorAll('.intel-location-city-options label')].find(label=>label.textContent.includes('南京')).querySelector('input')")
  await until("document.querySelectorAll('.intel-card').length===1", "single city selection")
  await click("document.querySelector('[aria-label=选择江苏全部地区]')")
  await until("document.querySelectorAll('.intel-card').length===2", "whole province replaces child")
  await click("[...document.querySelectorAll('.intel-location-region-button')].find(button=>button.textContent.includes('浙江'))")
  await click("document.querySelector('.intel-location-city-options input')")
  await until("document.querySelectorAll('.intel-card').length===3", "province plus other province city OR")
  await click(button("类型"))
  assert.equal(await evaluate(openMenus), 1, "only one menu can be open")
  assert.equal(await evaluate("!!document.querySelector('.intel-location-cascade')"), false)
  await evaluate("document.querySelector('.intel-search input').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))")
  await until(`${openMenus}===0`, "outside pointer closes menus")
  await click(button("来源"))
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 })
  await until(`${openMenus}===0`, "escape closes menus")
  await writeFile("building-test-results/desktop.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"))
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await click(button("发布地区"))
  await click("[...document.querySelectorAll('.intel-location-region-button')].find(button=>button.textContent.includes('江苏'))")
  assert(await evaluate("(()=>{const r=document.querySelector('.intel-location-menu').getBoundingClientRect();return r.left>=0&&r.right<=390})()"), "mobile cascader within viewport")
  await writeFile("building-test-results/mobile.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"))
  for (const path of ["/?topic=health", "/?topic=ai", "/?topic=finance", "/?topic=building&topic=health", "/c/hottest"]) {
    requests.length = 0
    await send("Page.navigate", { url: `http://127.0.0.1:4174${path}` })
    await until("document.body.innerText.includes('暂未开放')", `disabled route ${path}`)
    await sleep(200)
    assert.equal(requests.length, 0, `disabled route must not request any feed: ${path}`)
  }
  assert.equal(exceptions.length, 0, exceptions.join("\n"))
  const report = { result: "pass", cases: ["building only", "no login/admin/AI APIs", "five-minute version check", "cities collapsed", "two-level cascader", "province/city selection", "OR geography", "mutually exclusive menus", "outside close", "Escape close", "mobile width", "old routes no fetch"], exceptions }
  await writeFile("building-test-results/report.json", JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} catch (error) {
  await writeFile("building-test-results/failure.txt", String(error) + "\n" + exceptions.join("\n"))
  await writeFile("building-test-results/failure.png", Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"))
  throw error
} finally { ws.close(); server.closeAllConnections(); server.close() }
