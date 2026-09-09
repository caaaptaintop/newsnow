import assert from "node:assert/strict"
const base = process.env.BUILDING_SMOKE_URL || "https://news.capx-ai.com"
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function request(path, options) {
  return fetch(`${base}${path}`, { ...options, redirect: "manual", signal: AbortSignal.timeout(30000) })
}
let data
for (let i = 0; i < 6; i++) {
  const response = await request("/api/intelligence?topic=building")
  if (response.ok) {
    const candidate = await response.json()
    if (candidate.topic === "building" && /^\d+$/.test(candidate.version ?? "")) { data = candidate; break }
  }
  await sleep(5000)
}
assert(data, "building-only deployment did not become ready")
assert(data.articles.length <= 50, "real server-side page size");
assert(data.totalPublished >= data.articles.length, "database total");
assert(data.articles.length > 0, "existing building metadata must not disappear")
assert.equal(data.sources.length, 54)
assert(data.articles.every(article => article.topic === "building"))
for (const field of ["states", "model", "aiEnabled", "persistent", "pipeline"]) assert(!(field in data), `internal field returned: ${field}`)
assert(data.articles.every(article => !("model" in article) && !("analysisVersion" in article) && !("body" in article) && !("html" in article)))
// These checks exercise the deployed D1 reader, not browser fixtures or local SQLite.
let checkedNextPage = false, checkedHistoricalSearch = false
if (data.nextCursor) {
  const nextResponse = await request(`/api/intelligence?topic=building&cursor=${encodeURIComponent(data.nextCursor)}`)
  assert.equal(nextResponse.status, 200, "next cursor must read from D1")
  const next = await nextResponse.json()
  assert.equal(next.version, data.version)
  assert.equal(next.total, data.total)
  assert(next.articles.length > 0 && next.articles.length <= 50)
  const firstKeys = new Set(data.articles.map(a => a.key))
  assert(next.articles.every(a => !firstKeys.has(a.key)), "cursor pages must not overlap")
  checkedNextPage = true
  const target = next.articles[0]
  const query = target.title.trim().split(/\s+/).slice(0, 6).join(" ").slice(0, 180)
  const searchResponse = await request(`/api/intelligence?topic=building&q=${encodeURIComponent(query)}&limit=100`)
  assert.equal(searchResponse.status, 200)
  const found = await searchResponse.json()
  assert(found.articles.some(a => a.key === target.key), "search must reach records outside page one")
  checkedHistoricalSearch = true
  assert.equal((await request(`/api/intelligence?topic=building&limit=1&cursor=${encodeURIComponent(data.nextCursor)}`)).status, 409, "a cursor must not be reused with a different page contract")
}
assert.equal((await request("/api/intelligence?topic=building&limit=101")).status, 400)
const unauthorized = await request("/api/internal/building", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"action":"status"}' })
assert.equal(unauthorized.status, 401, "machine operations must reject anonymous requests")
const version = await (await request("/api/intelligence/version?topic=building")).json()
assert.equal(version.version, data.version)
assert(!("articles" in version))
for (const topic of ["health", "ai", "finance"]) {
  assert.equal((await request(`/api/intelligence?topic=${topic}`)).status, 404)
  assert.equal((await request(`/api/intelligence/version?topic=${topic}`)).status, 404)
}
assert.equal((await request("/api/intelligence?topic=building&topic=health")).status, 400)
for (const [path, method] of [
  ["/api/topics/health/status", "GET"], ["/api/topics/health/classify", "POST"],
  ["/api/intelligence/refresh", "POST"], ["/api/intelligence/ai/test", "POST"],
  ["/api/intelligence/ai/settings", "GET"], ["/api/intelligence/storage", "GET"],
  ["/api/login", "GET"], ["/api/oauth/github", "GET"], ["/api/me", "GET"],
  ["/api/enable-login", "GET"], ["/api/s", "GET"], ["/api/s/entire", "POST"],
]) {
  const response = await request(path, { method, ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: "{}" } : {}) })
  assert.equal(response.status, 404, `${method} ${path} must be closed`)
}
const rejectedAttachment = await request("/api/intelligence/attachment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: "health", articleKey: "closed", url: "https://example.gov.cn/a.doc" }) })
assert.equal(rejectedAttachment.status, 404)
console.log(JSON.stringify({ result: "pass", buildingArticles: data.articles.length, sources: data.sources.length, totalPublished: data.totalPublished, version: data.version, checkedNextPage, checkedHistoricalSearch, otherTopics: "closed", login: "disabled", aiAndAdmin: "closed", attachmentBytesRequested: 0 }))
