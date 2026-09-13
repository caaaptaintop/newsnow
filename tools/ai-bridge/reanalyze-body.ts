import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { type BatchItem, canonicalItems, normalizeBatchItem } from "../../shared/building-contract"
import { intelligenceSources } from "../../shared/official-sources"
import { type IntelligenceArticle, intelligenceVersion } from "../../shared/intelligence"
import type { IntelligenceDecision } from "../../server/utils/intelligence-ai"
import { classifyBatch, prepareClassifyBody } from "./classify-batch"
import { enrichOfficialArticlesForClassify } from "./enrich-article"

export const ANALYSIS_FIELDS = ["category", "relatedCategories", "tags", "contentType", "importance", "summary", "reason", "evidence", "model", "analysisVersion"] as const
export const IDENTITY_FIELDS = ["key", "title", "url", "sourceId", "sourceName", "sourceGroup", "sourceLevel", "region", "city", "column", "publisher", "documentNo", "publishedAt", "publicationDate", "collectedAt", "attachments", "otherSources"] as const

const PUBLIC_BASE = "https://news.capx-ai.com"

export type LockedArticle = Pick<IntelligenceArticle, "key" | "topic" | "title" | "url" | "sourceId" | "sourceName" | "sourceGroup" | "sourceLevel" | "region" | "city" | "column" | "collectedAt" | "attachments" | "category" | "relatedCategories" | "tags" | "contentType" | "importance" | "summary" | "evidence"> & {
  publisher?: IntelligenceArticle["publisher"]
  documentNo?: IntelligenceArticle["documentNo"]
  publishedAt?: IntelligenceArticle["publishedAt"]
  publicationDate?: IntelligenceArticle["publicationDate"]
  reason?: IntelligenceArticle["reason"]
  otherSources?: IntelligenceArticle["otherSources"]
}

export interface LockedBaseline {
  revision: number
  updatedAt?: number
  totalPublished: number
  articles: LockedArticle[]
}

export interface AnalysisChange {
  field: typeof ANALYSIS_FIELDS[number]
  from: unknown
  to: unknown
}

export interface ReanalysisProposal {
  key: string
  keep: boolean
  delete: false
  review?: "pending"
  stopBackfill?: boolean
  note?: string
  extract: "ok" | "fetch_failed" | "insufficient"
  evidence: "body" | "title"
  bodyChars: number
  truncated: boolean
  unchanged: Record<string, unknown>
  current: Record<string, unknown>
  proposed?: Record<string, unknown>
  changes: AnalysisChange[]
  article?: IntelligenceArticle
}

function withoutContent(article: Record<string, any>): Record<string, any> {
  const { body: _body, html: _html, text: _text, ...rest } = article
  return rest
}

export function lockArticle(raw: any): LockedArticle {
  if (!raw || typeof raw.key !== "string" || !/^building:[a-f0-9]{64}$/.test(raw.key)) throw new Error("公开文章编号无效")
  const article = withoutContent(raw)
  return {
    key: article.key,
    topic: "building",
    title: article.title,
    url: article.url,
    sourceId: article.sourceId,
    sourceName: article.sourceName,
    sourceGroup: article.sourceGroup,
    sourceLevel: article.sourceLevel,
    region: article.region,
    city: article.city,
    column: article.column,
    publisher: article.publisher,
    documentNo: article.documentNo,
    publishedAt: article.publishedAt,
    publicationDate: article.publicationDate,
    collectedAt: article.collectedAt,
    attachments: (article.attachments ?? []).map((attachment: any) => ({ title: attachment.title, url: attachment.url })),
    otherSources: article.otherSources?.map((source: any) => ({ name: source.name, url: source.url })),
    category: article.category,
    relatedCategories: [...(article.relatedCategories ?? [])],
    tags: [...(article.tags ?? [])],
    contentType: article.contentType,
    importance: article.importance,
    summary: article.summary,
    reason: article.reason,
    evidence: article.evidence === "body" ? "body" : "title",
  }
}

export function lockPublicFeed(version: { version: string | number, totalPublished?: number, updatedAt?: number }, feed: { version?: string | number, articles?: any[], totalPublished?: number, nextCursor?: string | null, truncated?: boolean }): LockedBaseline {
  const revision = Number(version.version)
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("公开版本无效")
  if (String(feed.version ?? "") !== String(version.version)) throw new Error("公开列表版本与独立版本不一致")
  if (Number(feed.totalPublished) !== Number(version.totalPublished)) throw new Error("公开篇数与独立版本不一致")
  if (feed.nextCursor) throw new Error("公开列表未完整，存在下一页")
  if (feed.truncated) throw new Error("公开列表被截断")
  const articles = (feed.articles ?? []).map(lockArticle)
  const keys = articles.map(article => article.key)
  if (new Set(keys).size !== keys.length) throw new Error("公开列表存在重复文章编号")
  const totalPublished = Number(version.totalPublished)
  if (!Number.isSafeInteger(totalPublished) || totalPublished < 1) throw new Error("公开篇数无效")
  if (articles.length !== totalPublished) throw new Error("公开列表篇数与版本总数不一致")
  return {
    revision,
    updatedAt: version.updatedAt,
    totalPublished,
    articles,
  }
}

export function assertBaselineUnchanged(locked: LockedBaseline, live: LockedBaseline) {
  if (locked.revision !== live.revision) throw new Error(`基线 revision 漂移：锁定 ${locked.revision}，当前 ${live.revision}`)
  if (locked.totalPublished !== live.totalPublished) throw new Error(`基线篇数漂移：锁定 ${locked.totalPublished}，当前 ${live.totalPublished}`)
  if (locked.articles.length !== live.articles.length) throw new Error("基线文章数量漂移，停止回填")
  const liveByKey = new Map(live.articles.map(article => [article.key, article]))
  if (liveByKey.size !== locked.articles.length) throw new Error("基线文章编号集合漂移，停止回填")
  for (const article of locked.articles) {
    const current = liveByKey.get(article.key)
    if (!current) throw new Error(`基线缺失文章 ${article.key}，停止回填`)
    for (const field of IDENTITY_FIELDS) {
      if (JSON.stringify(current[field] ?? null) !== JSON.stringify(article[field] ?? null)) {
        throw new Error(`基线文章 ${article.key} 字段 ${field} 漂移，停止回填`)
      }
    }
  }
}

function publicHiddenField(value: unknown) {
  return typeof value === "string" && value.trim() && value !== "unknown" ? value : "unknown"
}

function analysisSnapshot(article: Record<string, any>) {
  return {
    category: article.category,
    relatedCategories: [...(article.relatedCategories ?? [])],
    tags: [...(article.tags ?? [])],
    contentType: article.contentType,
    importance: article.importance,
    summary: article.summary,
    reason: article.reason,
    evidence: article.evidence,
    model: publicHiddenField(article.model),
    analysisVersion: publicHiddenField(article.analysisVersion),
  }
}

function identitySnapshot(article: LockedArticle) {
  return Object.fromEntries(IDENTITY_FIELDS.map(field => [field, article[field]]))
}

export function buildReanalysisProposal(article: LockedArticle, decision: IntelligenceDecision, extract: ReanalysisProposal["extract"], bodyChars: number, truncated: boolean, model: string): ReanalysisProposal {
  const evidence: "body" | "title" = extract === "ok" ? "body" : "title"
  const current = analysisSnapshot(article)
  const unchanged = identitySnapshot(article)
  if (!decision.keep) {
    return {
      key: article.key,
      keep: false,
      delete: false,
      review: "pending",
      stopBackfill: true,
      note: "keep=false 不得删除旧文章；标为待审并停止对应回填",
      extract,
      evidence,
      bodyChars,
      truncated,
      unchanged,
      current,
      changes: [],
    }
  }
  const proposedArticle = {
    ...withoutContent(article),
    category: decision.category,
    relatedCategories: decision.relatedCategories,
    tags: decision.tags,
    contentType: decision.contentType,
    importance: decision.importance,
    summary: decision.summary,
    reason: decision.reason,
    evidence,
    model,
    analysisVersion: intelligenceVersion,
  } as IntelligenceArticle
  const proposed = analysisSnapshot(proposedArticle)
  const changes = ANALYSIS_FIELDS
    .filter(field => JSON.stringify(current[field] ?? null) !== JSON.stringify(proposed[field] ?? null))
    .map(field => ({ field, from: current[field], to: proposed[field] }))
  return {
    key: article.key,
    keep: true,
    delete: false,
    extract,
    evidence,
    bodyChars,
    truncated,
    unchanged,
    current,
    proposed,
    changes,
    article: proposedArticle,
  }
}

export function publishItemsFromProposals(proposals: ReanalysisProposal[]): BatchItem[] {
  return canonicalItems(proposals.flatMap((proposal) => {
    if (!proposal.keep || !proposal.article) return []
    return [normalizeBatchItem({ kind: "article", key: proposal.key, data: proposal.article })]
  }))
}

export function assertNoPersistedBody(value: unknown, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPersistedBody(item, `${path}[${index}]`))
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, child] of Object.entries(value)) {
    if (["body", "html", "text"].includes(key)) throw new Error(`Persisted body field ${path}.${key}`)
    assertNoPersistedBody(child, `${path}.${key}`)
  }
}

export async function fetchPublicBuildingBaseline(base = PUBLIC_BASE): Promise<LockedBaseline> {
  const versionResponse = await fetch(`${base}/api/intelligence/version?topic=building`, { redirect: "manual", signal: AbortSignal.timeout(30000) })
  if (!versionResponse.ok) throw new Error(`公开版本读取失败 HTTP ${versionResponse.status}`)
  const version = await versionResponse.json() as { version: string, totalPublished?: number, updatedAt?: number }
  const feedResponse = await fetch(`${base}/api/intelligence?topic=building&limit=100`, { redirect: "manual", signal: AbortSignal.timeout(30000) })
  if (!feedResponse.ok) throw new Error(`公开列表读取失败 HTTP ${feedResponse.status}`)
  const feed = await feedResponse.json() as { version?: string, articles?: any[], totalPublished?: number, nextCursor?: string | null, truncated?: boolean }
  return lockPublicFeed(version, feed)
}

export async function reanalyzeLockedArticles(
  articles: LockedArticle[],
  options: { model: string, run?: (model: string, params: any) => Promise<any> },
): Promise<ReanalysisProposal[]> {
  const bySource = new Map<string, LockedArticle[]>()
  for (const article of articles) {
    const list = bySource.get(article.sourceId) ?? []
    list.push(article)
    bySource.set(article.sourceId, list)
  }
  const enrichments = new Map<string, { text?: string }>()
  const extract = new Map<string, ReanalysisProposal["extract"]>()
  for (const [sourceId, group] of bySource) {
    const source = intelligenceSources.find(item => item.id === sourceId)
    if (!source) {
      for (const article of group) extract.set(article.key, "fetch_failed")
      continue
    }
    const result = await enrichOfficialArticlesForClassify(source, group)
    for (const article of group) {
      const enrichment = result.enrichments.get(article.key)
      if (!enrichment) {
        extract.set(article.key, "fetch_failed")
      } else if (!enrichment.text) {
        extract.set(article.key, "insufficient")
      } else {
        extract.set(article.key, "ok")
        enrichments.set(article.key, enrichment)
      }
    }
  }
  const classifyItems = articles.map(article => ({
    key: article.key,
    title: article.title,
    column: article.column,
    ...(enrichments.get(article.key)?.text ? { body: enrichments.get(article.key)!.text } : {}),
  }))
  const run = options.run ?? (async (_model: string, params: any) => {
    const { localCodex } = await import("./local-codex.mjs")
    return localCodex(options.model, params.messages)
  })
  const decisions = await classifyBatch({ model: options.model, run }, "building", classifyItems)
  return articles.map((article) => {
    const text = enrichments.get(article.key)?.text
    return buildReanalysisProposal(
      article,
      decisions.get(article.key)!,
      extract.get(article.key) ?? "fetch_failed",
      text?.length ?? 0,
      prepareClassifyBody(text).truncated,
      options.model,
    )
  })
}

export function qualityRows(proposals: ReanalysisProposal[]) {
  return proposals.map(proposal => ({
    key: proposal.key,
    title: proposal.unchanged.title,
    url: proposal.unchanged.url,
    extract: proposal.extract,
    bodyChars: proposal.bodyChars,
    truncated: proposal.truncated,
    evidence: proposal.evidence,
    keep: proposal.keep,
    review: proposal.review,
    stopBackfill: proposal.stopBackfill,
    current: { category: proposal.current.category, summary: proposal.current.summary, evidence: proposal.current.evidence },
    proposed: proposal.proposed
      ? { category: proposal.proposed.category, summary: proposal.proposed.summary, evidence: proposal.proposed.evidence, reason: proposal.proposed.reason }
      : undefined,
    changedFields: proposal.changes.map(change => change.field),
  }))
}

export function reanalysisPlan(baseline: LockedBaseline, proposals: ReanalysisProposal[], model: string, options: { backfillable?: boolean, drift?: string } = {}) {
  const backfillable = options.backfillable !== false && !options.drift
  const publishItems = backfillable ? publishItemsFromProposals(proposals) : []
  const pendingReview = proposals.filter(proposal => !proposal.keep)
  const plan = {
    send: false,
    backfillable,
    ...(options.drift ? { drift: options.drift } : {}),
    model,
    analysisVersion: intelligenceVersion,
    baseline: {
      revision: baseline.revision,
      updatedAt: baseline.updatedAt,
      totalPublished: baseline.totalPublished,
      keys: baseline.articles.map(article => article.key),
    },
    quality: qualityRows(proposals),
    pendingReview: pendingReview.map(proposal => ({ key: proposal.key, title: proposal.unchanged.title, note: proposal.note })),
    publishItemKeys: publishItems.map(item => item.key),
    apply: {
      protocol: "existing publisherRequest publish",
      productionApiUnchanged: true,
      keepCollectedAt: true,
      keepIdentityFields: IDENTITY_FIELDS,
      analysisFieldsOnly: ANALYSIS_FIELDS,
      onKeepFalse: "mark pending review and stop that article's backfill; do not delete",
      onBaselineDrift: "stop; do not continue with a newer revision",
      default: "candidate only; do not send",
    },
  }
  assertNoPersistedBody(plan)
  assertNoPersistedBody(publishItems)
  return { plan, publishItems }
}

export function confirmBackfillablePlan(locked: LockedBaseline, live: LockedBaseline, proposals: ReanalysisProposal[], model: string) {
  try {
    assertBaselineUnchanged(locked, live)
    return reanalysisPlan(locked, proposals, model, { backfillable: true })
  } catch (error: any) {
    return reanalysisPlan(locked, proposals, model, { backfillable: false, drift: String(error?.message ?? error) })
  }
}

export async function runReanalyzeCli(args: string[], io: { fetchBaseline?: typeof fetchPublicBuildingBaseline, run?: (model: string, params: any) => Promise<any>, write?: typeof writeFile } = {}) {
  if (args.includes("--send")) throw new Error("默认只生成候选，拒绝发送；生产回填需高级独立审查")
  const option = (name: string, fallback: string) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback
  const limit = Number(option("--limit", "3"))
  if (!Number.isInteger(limit) || limit < 1 || limit > 30) throw new Error("limit 1–30")
  const model = option("--model", "gpt-5.6-luna")
  const outputDir = resolve(option("--output", ".local/body-94"))
  const fetchBaseline = io.fetchBaseline ?? fetchPublicBuildingBaseline
  const baseline = await fetchBaseline()
  const sample = baseline.articles.slice(0, limit)
  const proposals = await reanalyzeLockedArticles(sample, { model, run: io.run })
  const live = await fetchBaseline()
  const { plan, publishItems } = confirmBackfillablePlan(baseline, live, proposals, model)
  await mkdir(outputDir, { recursive: true })
  const write = io.write ?? writeFile
  await write(resolve(outputDir, "baseline.json"), `${JSON.stringify({ revision: baseline.revision, updatedAt: baseline.updatedAt, totalPublished: baseline.totalPublished, articles: baseline.articles.map(article => withoutContent(article)) }, null, 2)}\n`)
  await write(resolve(outputDir, "quality-sample.json"), `${JSON.stringify(plan.quality, null, 2)}\n`)
  await write(resolve(outputDir, "reanalysis-plan.json"), `${JSON.stringify({ ...plan, publishItems }, null, 2)}\n`)
  return { baseline, proposals, plan, outputDir }
}
