import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import process from "node:process"
import { isPublishedSource } from "../../shared/public-site"
import { intelligenceSources } from "../../shared/official-sources"
import { type IntelligenceArticle, intelligenceCanonicalUrl, intelligenceVersion } from "../../shared/intelligence"
import { publisherKnown } from "./publisher.mjs"
import { collectSource } from "./collect-source"
import { classifyEvidence, classifyThenPending } from "./classify-batch"
import { verifyPublicationDate } from "./publication-date"
import { enrichOfficialArticlesForClassify, officialArticlePersistedMetadata } from "./enrich-article"
import { localAntigravity } from "./local-antigravity.mjs"
import { agyModel } from "./antigravity-session.mjs"
import { batchArticleKeys, pageHasUnprocessed } from "./article-keys"
import { screenBuildingTitles, titleScreenLimit } from "./title-screen"
import { prioritizeCandidates, queuedCandidate, saveBatchResult } from "./candidate-queue"
import { collectionCandidates, collectionCutoff, inCollectionWindow, pageEntirelyBeforeWindow } from "./collection-window"
import { resolveCollectionSource, sourceConfigProvenance } from "./source-config-client"
import { collectionItemAllowed, collectionScopeKey } from "./collection-scope"

const collectionNow = Date.now()
const cutoff = collectionCutoff(collectionNow)
const args = process.argv.slice(2)
const option = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
const sourceId = option("--source", "all")
const selectedSources = intelligenceSources.filter(s => isPublishedSource(s) && (sourceId === "all" || sourceId.split(",").includes(s.id)))
const model = option("--model", agyModel)
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
  const configuredSources = (await Promise.all(selectedSources.map(source => resolveCollectionSource(source)))).filter(isPublishedSource)
  const sourceConfiguration = await sourceConfigProvenance()
  const collectedCache = new Map<string, any>()
  let priorBatch: any = {}
  try {
    priorBatch = JSON.parse(await readFile(resolve(outputDir, "result.json"), "utf8"))
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error
  }
  const pageNeedsMore = async (source: any, items: any[]) => {
    if (pageEntirelyBeforeWindow(items, cutoff)) return false
    const relevant = items
    if (!relevant.length) return false
    const keys = [...new Set<string>(relevant.flatMap(item => batchArticleKeys(source.topic, source.id, item.url)))]
    if (!keys.length) return false
    return pageHasUnprocessed(source.topic, source.id, relevant, [...await publisherKnown(keys), ...(priorBatch.processedVersions ?? []), ...(priorBatch.decisions ?? [])])
  }
  const queue = [...configuredSources]
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const source = queue.shift()!
      try {
        collectedCache.set(source.id, await collectSource(source, {
          maxPages: null,
          shouldContinuePage: items => pageNeedsMore(source, items),
        }))
      } catch (error) {
        collectedCache.set(source.id, { failure: error })
      }
    }
  }))
  let modelFailure = ""
  for (const source of configuredSources) {
    const scope = collectionScopeKey(source)
    let state: any = { id: source.id, checkedAt: Date.now(), status: "error" }
    let warnings: string[] = []
    let selectedCount = 0
    let processed = false
    state.collectionCounts = { discovered: 0, duplicates: 0, failed: 0 }
    try {
      let previous: any = { articles: [], decisions: [] }
      try {
        previous = JSON.parse(await readFile(resolve(outputDir, "result.json"), "utf8"))
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error
      }
      const sourceItems = [...(previous.pendingCandidates ?? []).filter((i: any) => i.sourceId === source.id).map((i: any) => ({ ...i, fromQueue: true })), ...(collectedCache.get(source.id)?.items ?? []).map((i: any) => ({ ...i, collectionScope: scope }))]
      const captured = new Map<string, any>()
      for (const item of sourceItems) {
        if (!item.title || !intelligenceCanonicalUrl(item.url)) continue
        const key = batchArticleKeys(source.topic, source.id, item.url)[0]
        const version = JSON.stringify([key, item.title])
        if (!captured.has(version) || (item.collectionScope === scope && captured.get(version).collectionScope !== scope)) captured.set(version, queuedCandidate({ ...item, key }, source.id, item.titleScreened === true))
      }
      previous.pendingCandidates = [...(previous.pendingCandidates ?? []).filter((i: any) => i.sourceId !== source.id), ...captured.values()]
      await saveBatchResult(resolve(outputDir, "result.json"), previous)
      const snapshot = JSON.parse(await readFile(resolve(root, ".data/mac-batch/published.json"), "utf8"))
      const keys = [...new Set<string>(sourceItems.flatMap((item: any) => batchArticleKeys(source.topic, source.id, item.url)))]
      const online = { articles: await publisherKnown(keys) }
      const knownRecords = [...snapshot.articles, ...online.articles, ...previous.articles, ...previous.decisions, ...(previous.processedVersions ?? [])]
      const known = new Set(knownRecords.map((a: any) => JSON.stringify([a.key, a.title])))
      const processedVersions = new Map(knownRecords.map((a: any) => [JSON.stringify([a.key, a.title]), { key: a.key, title: a.title }]))
      previous.processedVersions = [...processedVersions.values()]
      const candidates = new Map<string, any>()
      const collected = collectedCache.get(source.id)
      if (collected.failure) throw collected.failure
      warnings = collected.warnings
      state = { ...state, fetched: collected.items.length, columns: collected.columns, accepted: 0 }
      const lists = [sourceItems]
      for (const list of lists) {
        for (const item of list) {
          if (!item.title || !intelligenceCanonicalUrl(item.url)) continue
          const aliases = batchArticleKeys(source.topic, source.id, item.url)
          const key = aliases[0]
          if (aliases.some(alias => known.has(JSON.stringify([alias, item.title])))) {
            if (!item.fromQueue) state.collectionCounts.duplicates++
          } else if (aliases.some(alias => candidates.has(JSON.stringify([alias, item.title])))) {
            if (!item.fromQueue && !aliases.some(alias => candidates.get(JSON.stringify([alias, item.title]))?.fromQueue)) state.collectionCounts.duplicates++
          } else {
            candidates.set(JSON.stringify([key, item.title]), { ...item, key })
          }
        }
      }
      state.collectionCounts.discovered = [...candidates.values()].filter(item => !item.fromQueue).length
      const sourceQueue = [...candidates.values()].map(item => queuedCandidate(item, source.id, item.titleScreened === true))
      const otherPending = (previous.pendingCandidates ?? []).filter((i: any) => i.sourceId !== source.id)
      previous.pendingCandidates = [...otherPending, ...sourceQueue]
      await saveBatchResult(resolve(outputDir, "result.json"), previous)
      const activeQueue = prioritizeCandidates(collectionCandidates(sourceQueue.filter(item => collectionItemAllowed(item, configuredSources) && item.collectionScope === scope), cutoff, collectionNow))
      const outsideWindow = sourceQueue.length - activeQueue.length
      if (outsideWindow) warnings.push(`${outsideWindow} 条候选超出当前确认配置或日期超过一年、未知或无效，本轮不分析；原记录保留`)
      const titleItems = activeQueue.filter(item => !item.titleScreened).slice(0, titleScreenLimit)
      const usage: any[] = []
      const ai = { model, run: async (_model: string, params: any) => {
        if (modelFailure) throw new Error(`模型请求暂停，留待下轮：${modelFailure}`)
        try {
          return await localAntigravity(model, params.messages, (u: any) => usage.push(u))
        } catch (error: any) {
          modelFailure = error.message
          throw error
        }
      } }
      selectedCount = titleItems.length
      const titleDecisions = await screenBuildingTitles(ai, titleItems)
      const rejected = new Set<string>()
      for (const item of titleItems) {
        const decision = titleDecisions.get(item.key)
        if (!decision) continue
        if (decision.keep) {
          item.titleScreened = true
        } else {
          rejected.add(JSON.stringify([item.key, item.title]))
          processedVersions.set(JSON.stringify([item.key, item.title]), { key: item.key, title: item.title })
          previous.decisions = previous.decisions.filter((d: any) => d.key !== item.key)
          previous.decisions.push({ key: item.key, sourceId: source.id, title: item.title, url: item.url, keep: false, reason: decision.reason, at: Date.now() })
        }
      }
      previous.pendingCandidates = [...otherPending, ...sourceQueue.filter(item => !rejected.has(JSON.stringify([item.key, item.title])))]
      previous.processedVersions = [...processedVersions.values()]
      await saveBatchResult(resolve(outputDir, "result.json"), previous)
      const recalled = activeQueue.filter(item => item.titleScreened && !rejected.has(JSON.stringify([item.key, item.title])))
      const selected = recalled.slice(0, limit)
      selectedCount = selected.length
      const waiting = activeQueue.length - rejected.size - selected.length
      if (waiting > 0) warnings.push(`${waiting} 条候选已保留，待后续批次处理`)
      console.log(JSON.stringify({ source: source.name, model, newCandidates: candidates.size, selected: selected.map(i => ({ title: i.title, url: i.url })) }))
      if (!selected.length) {
        console.log("No new titles; no model request made")
      } else {
        if (modelFailure) throw new Error(`模型请求暂停，留待下轮：${modelFailure}`)
        const startedAt = Date.now()
        const { enrichments, fetchFailed, insufficient } = await enrichOfficialArticlesForClassify(source, selected)
        if (fetchFailed) warnings.push(`${fetchFailed} 篇正文获取失败，已按标题证据标记`)
        if (insufficient) warnings.push(`${insufficient} 篇正文不足，已按标题证据标记`)
        const classifyItems = selected.map(item => ({
          key: item.key,
          title: item.title,
          column: item.column,
          ...(enrichments.get(item.key)?.text ? { body: enrichments.get(item.key)!.text } : {}),
        }))
        const classified = await classifyThenPending(ai, source.topic, classifyItems, { sourceId: source.id, model, selected, usage })
        const { decisions, pending: pendingClassification } = classified
        await writeFile(resolve(outputDir, "PENDING-classification.json"), `${JSON.stringify(pendingClassification, null, 2)}\n`)
        if (decisions.size !== selected.length) throw new Error("Incomplete classifications; no results saved")
        const articles: IntelligenceArticle[] = selected.flatMap((item) => {
          const decision = decisions.get(item.key)!
          if (!decision.keep) return []
          const enrichment = enrichments.get(item.key)
          const evidence = classifyEvidence(enrichment?.text)
          return [{ collectionScope: scope, key: item.key, topic: source.topic, title: item.title, url: item.url, sourceId: source.id, sourceName: source.name, sourceGroup: source.group, sourceLevel: source.level, region: source.region, city: source.city, column: item.column, publishedAt: item.publishedAt, collectedAt: startedAt, attachments: [], ...(enrichment ? officialArticlePersistedMetadata(enrichment) : {}), category: decision.category, relatedCategories: decision.relatedCategories, tags: decision.tags, contentType: decision.contentType, importance: decision.importance, summary: decision.summary, reason: decision.reason, evidence, model, analysisVersion: intelligenceVersion }]
        })
        for (let i = 0; i < articles.length; i += 5) {
          await Promise.all(articles.slice(i, i + 5).map(async (article) => {
            Object.assign(article, await verifyPublicationDate(source, article, true))
            if (!inCollectionWindow(article, cutoff, collectionNow)) throw new Error("正文发布日期不在最近一年内或无法确认，本批保留待核对，未发布")
          }))
        }
        state.accepted = articles.length
        for (const item of selected) processedVersions.set(JSON.stringify([item.key, item.title]), { key: item.key, title: item.title })
        previous.processedVersions = [...processedVersions.values()]
        const result = { ...previous, pendingCandidates: previous.pendingCandidates.filter((i: any) => !selected.some(item => item.key === i.key && item.title === i.title)), generatedAt: Date.now(), sourceId: source.id, model, elapsedMs: Date.now() - startedAt, usage, articles: [...previous.articles.filter((a: any) => !decisions.has(a.key)), ...articles], decisions: [...previous.decisions.filter((d: any) => !decisions.has(d.key)), ...selected.map(item => ({ ...decisions.get(item.key), sourceId: source.id, at: startedAt, title: item.title, url: item.url }))] }
        await saveBatchResult(resolve(outputDir, "result.json"), result)
        console.log(JSON.stringify({ completed: selected.length, accepted: articles.length, elapsedMs: result.elapsedMs, usage, result: resolve(outputDir, "result.json") }))
      }
      processed = true
      state.status = warnings.length ? "partial" : "ok"
      if (!warnings.length) state.lastSuccessAt = Date.now()
    } catch (error: any) {
      state.collectionCounts.failed = processed ? 0 : selectedCount
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
    await saveBatchResult(resolve(outputDir, "result.json"), saved)
    console.log(JSON.stringify({ sourceId: source.id, state }))
  }
} finally {
  await lock.close()
  await import("node:fs/promises").then(fs => fs.unlink(resolve(outputDir, "running.lock")))
}
