import assert from "node:assert/strict"
const origin = process.env.BUILDING_SMOKE_URL || "https://news.capx-ai.com"
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const target = await (await fetch("http://127.0.0.1:9222/json/new?about:blank", { method: "PUT" })).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }) })
let sequence = 0
const pending = new Map(), exceptions = [], requests = []
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 15000)
    pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }))
  })
}
ws.addEventListener("message", event => {
  const message = JSON.parse(String(event.data)), task = pending.get(message.id)
  if (task) { pending.delete(message.id); clearTimeout(task.timer); if (message.error) task.reject(new Error(JSON.stringify(message.error))); else task.resolve(message.result) }
  if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  if (message.method === "Network.requestWillBeSent") {
    const request = message.params.request, url = new URL(request.url)
    if (url.origin === origin && url.pathname.startsWith("/api/")) requests.push({ path: url.pathname, method: request.method })
  }
})
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
  return result.result.value
}
async function until(expression, label) {
  for (let i = 0; i < 60; i++) { if (await evaluate(expression)) return; await sleep(500) }
  throw new Error(`Timed out: ${label}`)
}
try {
  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable")
  // Do not allow a regression in a production browser test to spend inference quota.
  await send("Network.setBlockedURLs", { urls: ["*/api/intelligence/refresh*", "*/api/topics/health/classify*", "*/api/intelligence/ai/*"] })
  for (const viewport of [{ width: 1280, height: 900, mobile: false }, { width: 390, height: 844, mobile: true }]) {
    requests.length = 0
    await send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1 })
    await send("Page.navigate", { url: `${origin}/?topic=building&public_smoke=${Date.now()}` })
    await until("document.querySelectorAll('.intel-card').length>0", "published building cards")
    assert.equal(await evaluate("document.title"), "建筑情报 · 个人信息情报站")
    assert.equal(await evaluate("document.querySelectorAll('[aria-label=建筑栏目] button').length"), 8)
    assert.equal(await evaluate("!!document.querySelector('.ai-settings-launch,.ai-settings-dialog,[aria-label=一级主题]')"), false)
    assert.equal(await evaluate("[...document.querySelectorAll('button,a')].some(element=>/^(运动健康|AI 科技|财经|原始热榜|注册|登录|GitHub 登录|AI 设置)$/.test(element.textContent.trim()))"), false)
    assert(requests.length > 0 && requests.every(request => request.method === "GET" && ["/api/intelligence", "/api/intelligence/version"].includes(request.path)), JSON.stringify(requests))
    console.log(JSON.stringify({ viewport: viewport.mobile ? "mobile" : "desktop", publishedCards: await evaluate("document.querySelectorAll('.intel-card').length"), result: "pass" }))
  }
  for (const path of ["/?topic=health", "/?topic=ai", "/?topic=finance", "/c/hottest"]) {
    requests.length = 0
    await send("Page.navigate", { url: origin + path })
    await until("document.body.innerText.includes('暂未开放')", "closed route")
    await sleep(300)
    assert.equal(requests.length, 0, `Closed route requested an API: ${path}`)
  }
  assert.equal(exceptions.length, 0, exceptions.join("\n"))
  console.log(JSON.stringify({ result: "pass", login: "absent", aiSettings: "absent", buildingOnly: true, disabledRoutes: 4, runtimeExceptions: 0 }))
} finally {
  for (const task of pending.values()) clearTimeout(task.timer)
  ws.close()
}
