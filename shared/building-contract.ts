import { intelligenceContentTypes, intelligenceTopics, type IntelligenceArticle } from "./intelligence"
import { intelligenceMetadataOnly } from "./intelligence-storage"

export const buildingLimits = Object.freeze({ pageSize: 50, maxPageSize: 100, batchItems: 20, requestBytes: 512 * 1024, itemBytes: 24 * 1024 })
export class BuildingError extends Error {
  statusCode: number
  constructor(statusCode: number, message: string) { super(message); this.statusCode = statusCode; this.name = "BuildingError" }
}
export type BatchItem = { kind: "article" | "decision" | "source", key: string, data: any }
const object = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v)
function text(v: unknown, limit: number, required = false): string {
  if (typeof v !== "string" || v.length > limit || (required && !v.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw new BuildingError(400, "元数据文本无效或过长")
  return v.trim()
}
function url(v: unknown) {
  const value = text(v, 4096, true)
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new BuildingError(400, "元数据链接无效") }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new BuildingError(400, "元数据链接无效")
  return value
}
function timestamp(v: unknown) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0 || v > 8640000000000000) throw new BuildingError(400, "元数据时间无效")
  return v
}
function list(v: unknown, max: number, length: number) {
  if (!Array.isArray(v) || v.length > max) throw new BuildingError(400, "元数据列表无效")
  return [...new Set(v.map(x => text(x, length, true)))]
}
export function normalizeBatchItem(input: unknown): BatchItem {
  if (!object(input) || !object(input.data) || !["article", "decision", "source"].includes(input.kind)) throw new BuildingError(400, "发布记录无效")
  const kind = input.kind as BatchItem["kind"], key = text(input.key, 200, true), d = input.data
  if (kind !== "source" && !/^building:[a-f0-9]{64}$/.test(key)) throw new BuildingError(400, "只接受建筑记录编号")
  let data: any
  if (kind === "decision") data = { title: text(d.title, 1000, true), at: timestamp(d.at) }
  else if (kind === "source") {
    if (!/^[\w-]{1,100}$/.test(key) || !["ok", "partial", "error"].includes(d.status)) throw new BuildingError(400, "来源状态无效")
    data = { status: d.status, checkedAt: timestamp(d.checkedAt), fetched: Math.max(0, Math.min(100000, Math.floor(Number(d.fetched) || 0))), accepted: Math.max(0, Math.min(100000, Math.floor(Number(d.accepted) || 0))) }
  } else {
    if (d.topic !== "building" || d.key !== key) throw new BuildingError(400, "该主题暂未开放")
    if (!["title", "body"].includes(d.evidence) || !Object.prototype.hasOwnProperty.call(intelligenceTopics.building.categories, d.category) || !(intelligenceContentTypes as readonly string[]).includes(d.contentType)) throw new BuildingError(400, "资讯分类无效")
    if (!Number.isInteger(d.importance) || d.importance < 0 || d.importance > 100) throw new BuildingError(400, "重要度无效")
    if (!Array.isArray(d.attachments) || d.attachments.length > 32) throw new BuildingError(400, "附件链接列表无效")
    const related = list(d.relatedCategories ?? [], 16, 100)
    if (related.some(c => !Object.prototype.hasOwnProperty.call(intelligenceTopics.building.categories, c))) throw new BuildingError(400, "关联栏目无效")
    let publicationDate: IntelligenceArticle["publicationDate"]
    if (d.publicationDate != null) {
      const p = d.publicationDate
      if (!object(p) || !["verified", "unknown"].includes(p.status) || (p.basis != null && !["article", "source_api", "source_list", "source_id"].includes(p.basis)) || (p.reason != null && !["not_article", "unavailable", "not_provided"].includes(p.reason))) throw new BuildingError(400, "日期证据无效")
      publicationDate = { status: p.status, basis: p.basis, url: url(p.url), checkedAt: timestamp(p.checkedAt), reason: p.reason }
    }
    const article: IntelligenceArticle = {
      key, topic: "building", title: text(d.title, 1000, true), url: url(d.url),
      sourceId: text(d.sourceId, 100, true), sourceName: text(d.sourceName, 200, true), sourceGroup: text(d.sourceGroup, 100), sourceLevel: text(d.sourceLevel, 100),
      region: text(d.region ?? "", 100), city: text(d.city ?? "", 100), column: text(d.column ?? "", 300),
      publisher: d.publisher == null ? undefined : text(d.publisher, 200), documentNo: d.documentNo == null ? undefined : text(d.documentNo, 300),
      publishedAt: publicationDate?.status === "verified" && d.publishedAt != null ? timestamp(d.publishedAt) : undefined,
      publicationDate, collectedAt: timestamp(d.collectedAt), category: d.category, relatedCategories: related, tags: list(d.tags ?? [], 40, 100), contentType: d.contentType,
      importance: d.importance, summary: text(d.summary, 4000, true), reason: d.reason == null ? undefined : text(d.reason, 2000), evidence: d.evidence,
      model: text(d.model ?? "migration", 200), analysisVersion: text(d.analysisVersion ?? "migration", 100),
      attachments: d.attachments.map((a: any) => { if (!object(a)) throw new BuildingError(400, "附件无效"); return { title: text(a.title, 240), url: url(a.url) } }),
      otherSources: d.otherSources == null ? undefined : (() => {
        if (!Array.isArray(d.otherSources) || d.otherSources.length > 32) throw new BuildingError(400, "转载列表无效")
        return d.otherSources.map((s: any) => ({ name: text(s.name, 200), url: url(s.url) }))
      })(),
    }
    data = intelligenceMetadataOnly(article)
  }
  const result = JSON.parse(JSON.stringify({ kind, key, data })) as BatchItem
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > buildingLimits.itemBytes) throw new BuildingError(413, "单条元数据过大")
  return result
}
export function canonicalItems(items: BatchItem[]) { return [...items].sort((a, b) => `${a.kind}:${a.key}` < `${b.kind}:${b.key}` ? -1 : `${a.kind}:${a.key}` > `${b.kind}:${b.key}` ? 1 : 0) }
export async function buildingHash(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("")
}
export function publicArticle(data: IntelligenceArticle) {
  const { model: _model, analysisVersion: _version, ...result } = intelligenceMetadataOnly(data)
  return result
}
export const locationCityId = (region: string, city: string) => JSON.stringify([region, city])
