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
console.log(JSON.stringify({ result: "pass", buildingArticles: data.articles.length, sources: data.sources.length, otherTopics: "closed", login: "disabled", aiAndAdmin: "closed", attachmentBytesRequested: 0 }))
