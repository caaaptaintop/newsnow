import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"
import { intelligenceSources } from "../../shared/official-sources"
import { type IntelligenceArticle, intelligenceCanonicalUrl, intelligenceDate, intelligenceVersion } from "../../shared/intelligence"
import { intelligenceDiscoverColumns, intelligenceFetchHtml, intelligenceParseList } from "../../server/utils/intelligence-parser"
import { buildingRecallScore } from "../../shared/building-recall"
import { classifyBatch } from "./classify-batch"
import { localCodex } from "./local-codex.mjs"

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const source = intelligenceSources.find(s => s.id === option("--source", "official-shanghai") && s.enabled)
const model = option("--model", "gpt-5.6-luna")
const limit = Number(option("--limit", "3"))
if (!source || !Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error("Choose a configured source and limit 1–30")
const root = resolve(import.meta.dirname, "../..")
const outputDir = resolve(root, ".data/mac-batch")
await mkdir(outputDir, { recursive: true })
const lockPath = resolve(outputDir, "running.lock")
try {
  const pid = Number(await readFile(lockPath, "utf8"))
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("Invalid batch lock; manual inspection needed")
  try {
    process.kill(pid, 0)
    throw new Error("A batch is already running")
  } catch (error: any) {
    if (error.code !== "ESRCH") throw error
    await import("node:fs/promises").then(fs => fs.unlink(lockPath))
  }
} catch (error: any) {
  if (error.code !== "ENOENT") throw error
}
const lock = await import("node:fs/promises").then(fs => fs.open(lockPath, "wx"))
await lock.writeFile(String(process.pid))
try {
  const snapshot = JSON.parse(await readFile(resolve(root, "data/intelligence-snapshot.json"), "utf8"))
  let previous: any = { articles: [], decisions: [] }
  try {
    previous = JSON.parse(await readFile(resolve(outputDir, "result.json"), "utf8"))
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error
  }
  const onlineResponse = await fetch(`https://news.capx-ai.com/api/intelligence?topic=${encodeURIComponent(source.topic)}`, { signal: AbortSignal.timeout(30000) })
  if (!onlineResponse.ok) throw new Error("Cannot check existing online articles; stopped to avoid duplicate analysis")
  const online: any = await onlineResponse.json()
  if (!Array.isArray(online.articles)) throw new Error("Online article list unavailable")
  const known = new Map<string, string>([...snapshot.articles, ...online.articles, ...previous.articles, ...previous.decisions].map((a: any) => [a.key, a.title]))
  const candidates = new Map<string, any>()
  const lists = []
  if (source.newsnowId) {
    const response = await fetch(`https://news.capx-ai.com/api/s?id=${encodeURIComponent(source.newsnowId)}&limit=30`, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`NewsNow source HTTP ${response.status}`)
    const feed: any = await response.json()
    if (!Array.isArray(feed.items)) throw new Error("NewsNow source unavailable")
    lists.push(feed.items.map((item: any) => ({ title: item.title, url: item.url, column: "热点与快讯", publishedAt: intelligenceDate(item.pubDate) })))
  } else {
    const home = source.columns?.length ? undefined : await intelligenceFetchHtml(source.home, source)
    const columns = source.columns?.length ? source.columns : intelligenceDiscoverColumns(home!.html, source, home!.url)
    if (!columns.length) throw new Error("No readable official columns")
    for (const column of columns.slice(0, 2)) {
      const page = await intelligenceFetchHtml(column.url, source)
      lists.push(intelligenceParseList(page.html, source, column))
    }
  }
  for (const list of lists) {
    for (const item of list) {
      if (!item.title || !intelligenceCanonicalUrl(item.url)) continue
      const key = `${source.topic}:${createHash("sha256").update(intelligenceCanonicalUrl(item.url)).digest("hex")}`
      if (known.get(key) !== item.title) candidates.set(key, { ...item, key })
    }
  }
  const selected = [...candidates.values()]
    .filter(item => source.topic !== "building" || buildingRecallScore(item) > 0)
    .sort((a, b) => source.topic === "building" ? buildingRecallScore(b) - buildingRecallScore(a) : 0)
    .slice(0, limit)
  console.log(JSON.stringify({ source: source.name, model, newCandidates: candidates.size, selected: selected.map(i => ({ title: i.title, url: i.url })) }))
  if (!selected.length) {
    console.log("No new titles; no model request made")
  } else {
    const startedAt = Date.now()
    const usage: any[] = []
    const decisions = await classifyBatch({ model, run: async (_model: string, params: any) => {
      const response = await localCodex(model, params.messages, (u: any) => usage.push(u))
      await writeFile(resolve(outputDir, "PENDING-classification.json"), `${JSON.stringify({ sourceId: source.id, model, input: selected, response, usage }, null, 2)}\n`)
      return response
    } }, source.topic, selected.map(item => ({ key: item.key, title: item.title, column: item.column })))
    if (decisions.size !== selected.length) throw new Error("Incomplete classifications; no results saved")
    const articles: IntelligenceArticle[] = selected.flatMap((item) => {
      const decision = decisions.get(item.key)!
      if (!decision.keep) return []
      return [{ key: item.key, topic: source.topic, title: item.title, url: item.url, sourceId: source.id, sourceName: source.name, sourceGroup: source.group, sourceLevel: source.level, region: source.region, city: source.city, column: item.column, publishedAt: item.publishedAt, collectedAt: startedAt, attachments: [], category: decision.category, relatedCategories: decision.relatedCategories, tags: decision.tags, contentType: decision.contentType, importance: decision.importance, summary: decision.summary, reason: decision.reason, evidence: "title", model, analysisVersion: intelligenceVersion }]
    })
    const result = { generatedAt: Date.now(), sourceId: source.id, model, elapsedMs: Date.now() - startedAt, usage, articles: [...previous.articles.filter((a: any) => !decisions.has(a.key)), ...articles], decisions: [...previous.decisions.filter((d: any) => !decisions.has(d.key)), ...selected.map(item => ({ ...decisions.get(item.key), sourceId: source.id, at: startedAt, title: item.title, url: item.url }))] }
    const pending = resolve(outputDir, "result.pending.json")
    await writeFile(pending, `${JSON.stringify(result, null, 2)}\n`)
    await import("node:fs/promises").then(fs => fs.rename(pending, resolve(outputDir, "result.json")))
    console.log(JSON.stringify({ completed: selected.length, accepted: articles.length, elapsedMs: result.elapsedMs, usage, result: resolve(outputDir, "result.json") }))
  }
} finally {
  await lock.close()
  await import("node:fs/promises").then(fs => fs.unlink(resolve(outputDir, "running.lock")))
}
