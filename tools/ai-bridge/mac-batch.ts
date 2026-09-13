import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"
import { isPublishedSource } from "../../shared/public-site"
import { intelligenceSources } from "../../shared/official-sources"
import { type IntelligenceArticle, intelligenceCanonicalUrl, intelligenceVersion } from "../../shared/intelligence"
import { buildingRecallScore } from "../../shared/building-recall"
import { publisherKnown } from "./publisher.mjs"
import { collectSource } from "./collect-source"
import { classifyEvidence, classifyThenPending } from "./classify-batch"
import { verifyPublicationDate } from "./publication-date"
import { enrichOfficialArticlesForClassify, officialArticlePersistedMetadata } from "./enrich-article"
import { localCodex } from "./local-codex.mjs"
import { batchArticleKeys } from "./article-keys"
import { resolvePublishedSource, sourceConfigProvenance } from "./source-config-client"

const args = process.argv.slice(2)
const option = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const sourceId = option("--source", "official-shanghai")
const selectedSources = intelligenceSources.filter(s => isPublishedSource(s) && (sourceId === "all" || sourceId.split(",").includes(s.id)))
const model = option("--model", "gpt-5.6-luna")
const limit = Number(option("--limit", "12"))
if (!selectedSources.length || !Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error("Choose a configured source and limit 1–30")
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
  // Resolve once for the whole process; collection, metadata and dates use the same source.
  const configuredSources = (await Promise.all(selectedSources.map(source => resolvePublishedSource(source)))).filter(isPublishedSource)
  const sourceConfiguration = await sourceConfigProvenance()
  const collectedCache = new Map<string, any>()
  const pageNeedsMore = async (source: any, items: any[]) => {
    const relevant = source.topic === "building" ? items.filter(item => buildingRecallScore(item) > 0) : items
    if (!relevant.length) return false
    const keys = [...new Set<string>(relevant.flatMap(item => batchArticleKeys(source.topic, source.id, item.url)))]
    if (!keys.length) return false
    try {
      const known = new Set((await publisherKnown(keys)).map((record: any) => record.key))
      return relevant.some(item => batchArticleKeys(source.topic, source.id, item.url).every(alias => !known.has(alias)))
    } catch {
      // Preserve the current page. The normal dedup query below will surface
      // the publisher failure rather than turning it into extra origin traffic.
      return false
    }
  }
  const queue = [...configuredSources]
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const source = queue.shift()!
      try {
        collectedCache.set(source.id, await collectSource(source, {
          maxPages: 5,
          shouldContinuePage: items => pageNeedsMore(source, items),
        }))
      } catch (error) {
        collectedCache.set(source.id, { failure: error })
      }
    }
  }))
  let modelFailure = ""
  for (const source of configuredSources) {
    let state: any = { id: source.id, checkedAt: Date.now(), status: "error" }
    let warnings: string[] = []
    try {
      const snapshot = JSON.parse(await readFile(resolve(root, ".data/mac-batch/published.json"), "utf8"))
      let previous: any = { articles: [], decisions: [] }
      try {
        previous = JSON.parse(await readFile(resolve(outputDir, "result.json"), "utf8"))
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error
      }
      const sourceItems = collectedCache.get(source.id)?.items ?? []
      const keys = [...new Set<string>(sourceItems.flatMap((item: any) => batchArticleKeys(source.topic, source.id, item.url)))]
      const online = { articles: await publisherKnown(keys) }
      const known = new Map<string, string>([...snapshot.articles, ...online.articles, ...previous.articles, ...previous.decisions].map((a: any) => [a.key, a.title]))
      const candidates = new Map<string, any>()
      const collected = collectedCache.get(source.id)
      if (collected.failure) throw collected.failure
      warnings = collected.warnings
      state = { ...state, fetched: collected.items.length, columns: collected.columns, accepted: 0 }
      const lists = [collected.items]
      for (const list of lists) {
        for (const item of list) {
          if (!item.title || !intelligenceCanonicalUrl(item.url)) continue
          const aliases = batchArticleKeys(source.topic, source.id, item.url)
          const key = aliases[0]
          if (!aliases.some(alias => known.get(alias) === item.title || candidates.get(alias)?.title === item.title)) candidates.set(key, { ...item, key })
        }
      }
      const recalled = [...candidates.values()]
        .filter(item => source.topic !== "building" || buildingRecallScore(item) > 0)
        .sort((a, b) => source.topic === "building" ? buildingRecallScore(b) - buildingRecallScore(a) : 0)
      const selected = recalled.slice(0, limit)
      if (recalled.length > limit) warnings.push(`${recalled.length - limit} 条候选待后续批次分析`)
      console.log(JSON.stringify({ source: source.name, model, newCandidates: candidates.size, selected: selected.map(i => ({ title: i.title, url: i.url })) }))
      if (!selected.length) {
        console.log("No new titles; no model request made")
      } else {
        if (modelFailure) throw new Error(`模型请求暂停，留待下轮：${modelFailure}`)
        const startedAt = Date.now()
        const usage: any[] = []
        const { enrichments, fetchFailed, insufficient } = await enrichOfficialArticlesForClassify(source, selected)
        if (fetchFailed) warnings.push(`${fetchFailed} 篇正文获取失败，已按标题证据标记`)
        if (insufficient) warnings.push(`${insufficient} 篇正文不足，已按标题证据标记`)
        const classifyItems = selected.map(item => ({
          key: item.key,
          title: item.title,
          column: item.column,
          ...(enrichments.get(item.key)?.text ? { body: enrichments.get(item.key)!.text } : {}),
        }))
        const { decisions, pending: pendingClassification } = await classifyThenPending({ model, run: async (_model: string, params: any) => {
          try {
            return await localCodex(model, params.messages, (u: any) => usage.push(u))
          } catch (error: any) {
            modelFailure = error.message
            throw error
          }
        } }, source.topic, classifyItems, { sourceId: source.id, model, selected, usage })
        await writeFile(resolve(outputDir, "PENDING-classification.json"), `${JSON.stringify(pendingClassification, null, 2)}\n`)
        if (decisions.size !== selected.length) throw new Error("Incomplete classifications; no results saved")
        const articles: IntelligenceArticle[] = selected.flatMap((item) => {
          const decision = decisions.get(item.key)!
          if (!decision.keep) return []
          const enrichment = enrichments.get(item.key)
          const evidence = classifyEvidence(enrichment?.text)
          return [{ key: item.key, topic: source.topic, title: item.title, url: item.url, sourceId: source.id, sourceName: source.name, sourceGroup: source.group, sourceLevel: source.level, region: source.region, city: source.city, column: item.column, publishedAt: item.publishedAt, collectedAt: startedAt, attachments: [], ...(enrichment ? officialArticlePersistedMetadata(enrichment) : {}), category: decision.category, relatedCategories: decision.relatedCategories, tags: decision.tags, contentType: decision.contentType, importance: decision.importance, summary: decision.summary, reason: decision.reason, evidence, model, analysisVersion: intelligenceVersion }]
        })
        for (let i = 0; i < articles.length; i += 5) {
          await Promise.all(articles.slice(i, i + 5).map(async (article) => {
            Object.assign(article, await verifyPublicationDate(source, article, true))
          }))
        }
        state.accepted = articles.length
        const result = { ...previous, generatedAt: Date.now(), sourceId: source.id, model, elapsedMs: Date.now() - startedAt, usage, articles: [...previous.articles.filter((a: any) => !decisions.has(a.key)), ...articles], decisions: [...previous.decisions.filter((d: any) => !decisions.has(d.key)), ...selected.map(item => ({ ...decisions.get(item.key), sourceId: source.id, at: startedAt, title: item.title, url: item.url }))] }
        const pending = resolve(outputDir, "result.pending.json")
        await writeFile(pending, `${JSON.stringify(result, null, 2)}\n`)
        await import("node:fs/promises").then(fs => fs.rename(pending, resolve(outputDir, "result.json")))
        console.log(JSON.stringify({ completed: selected.length, accepted: articles.length, elapsedMs: result.elapsedMs, usage, result: resolve(outputDir, "result.json") }))
      }
      state.status = warnings.length ? "partial" : "ok"
      if (!warnings.length) state.lastSuccessAt = Date.now()
    } catch (error: any) {
      state.status = state.fetched ? "partial" : "error"
      warnings.push(error.message)
    }
    if (warnings.length) state.error = warnings.join("；").slice(0, 700)
    let saved: any = { articles: [], decisions: [], states: [] }
    try {
      saved = JSON.parse(await readFile(resolve(outputDir, "result.json"), "utf8"))
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error
    }
    saved.states = [...(saved.states ?? []).filter((s: any) => s.id !== source.id), state]
    saved.sourceConfiguration = sourceConfiguration
    saved.pipeline = "mac"
    saved.generatedAt = Date.now()
    await writeFile(resolve(outputDir, "result.pending.json"), `${JSON.stringify(saved, null, 2)}\n`)
    await import("node:fs/promises").then(fs => fs.rename(resolve(outputDir, "result.pending.json"), resolve(outputDir, "result.json")))
    console.log(JSON.stringify({ sourceId: source.id, state }))
  }
} finally {
  await lock.close()
  await import("node:fs/promises").then(fs => fs.unlink(resolve(outputDir, "running.lock")))
}
