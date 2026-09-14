import { BuildingError, buildingHash, buildingLimits, publicArticle } from "../../shared/building-contract"
import { type IntelligenceFilters, type IntelligenceSource, emptyIntelligenceFilters, intelligenceTopics } from "../../shared/intelligence"
import { intelligenceSources } from "../../shared/official-sources"
import { isPublishedSource } from "../../shared/public-site"
import { type ApprovedSourceScope, extractApprovedSourceScope } from "../../shared/source-collection-approval"
import { type PublishedSourceConfig, sourceCatalogRevision } from "../../shared/source-config"
import { type BuildingDB, buildingMeta } from "./store"

export function readQuery(params: URLSearchParams) {
  if (params.toString().length > 8000) throw new BuildingError(400, "筛选条件过长")
  const one = (key: string) => {
    const v = params.getAll(key)
    if (v.length > 1) throw new BuildingError(400, "参数重复")
    return v[0] ?? ""
  }
  const f = emptyIntelligenceFilters()
  f.q = one("q").trim()
  f.category = one("category")
  if (f.q.length > 200 || f.q.split(/\s+/).length > 12) throw new BuildingError(400, "搜索词过长")
  if (f.category && !Object.prototype.hasOwnProperty.call(intelligenceTopics.building.categories, f.category)) throw new BuildingError(400, "栏目无效")
  let count = 0
  for (const key of ["regions", "cities", "types", "sources"] as const) {
    const v = params.getAll(key)
    if (v.length > 30 || v.some(s => !s || s.length > 220)) throw new BuildingError(400, "筛选值无效")
    f[key] = [...new Set(v)].sort()
    count += f[key].length
  }
  if (count + f.sources.length > 65) throw new BuildingError(400, "同时选择的筛选项过多")
  f.days = Number(one("days") || 0)
  f.importance = Number(one("importance") || 0)
  const sort = one("sort") || "latest"
  const limit = Number(one("limit") || buildingLimits.pageSize)
  const cursor = one("cursor")
  if (![0, 7, 30, 90, 365].includes(f.days) || ![0, 60, 80].includes(f.importance) || !["latest", "importance", "recommended"].includes(sort) || !Number.isInteger(limit) || limit < 1 || limit > buildingLimits.maxPageSize || cursor.length > 1600) throw new BuildingError(400, "筛选或分页参数无效")
  f.sort = sort as IntelligenceFilters["sort"]
  return { filters: f, limit, cursor }
}
export function buildApprovedSourceFilter(approved?: ApprovedSourceScope[]) {
  if (!approved) return { where: "", binds: [] }
  if (approved.length === 0) return { where: "0=1", binds: [] }
  const validScopes = approved.filter(item => item.sourceId && item.columns && item.columns.length > 0)
  if (validScopes.length === 0) return { where: "0=1", binds: [] }
  const jsonParam = JSON.stringify(validScopes.map(item => ({
    sourceId: item.sourceId,
    columns: item.columns.filter(Boolean),
  })))
  return {
    where: "EXISTS (SELECT 1 FROM json_each(?) AS s, json_each(json_extract(s.value, '$.columns')) AS c WHERE d.source_id = json_extract(s.value, '$.sourceId') AND json_extract(d.data, '$.column') = c.value)",
    binds: [jsonParam],
  }
}

function decode(value: string) {
  try {
    const c = JSON.parse(atob(value))
    if (!c || !Number.isSafeInteger(c.revision) || !/^[a-f0-9]{64}$/.test(c.hash) || !Number.isSafeInteger(c.at) || !Array.isArray(c.last) || c.last.length !== 4 || !c.last.slice(0, 3).every((n: any) => Number.isSafeInteger(n) && n >= 0) || typeof c.last[3] !== "string" || !/^building:[a-f0-9]{64}$/.test(c.last[3])) throw new Error("invalid cursor")
    if (c.configRevision !== undefined && (typeof c.configRevision !== "string" || !/^[a-f0-9]{64}$/.test(c.configRevision))) throw new Error("invalid cursor config revision")
    return c as { revision: number, configRevision?: string, hash: string, at: number, last: [number, number, number, string] }
  } catch {
    throw new BuildingError(400, "翻页标记无效，请刷新列表")
  }
}
function conditions(f: IntelligenceFilters, at: number, approvedScope?: ApprovedSourceScope[]) {
  const clauses: string[] = []
  const binds: any[] = []
  const scope = buildApprovedSourceFilter(approvedScope)
  if (scope.where) {
    clauses.push(scope.where)
    binds.push(...scope.binds)
  }
  if (f.category) {
    clauses.push("d.category=?")
    binds.push(f.category)
  }

  const locations: string[] = []
  if (f.regions.length) {
    locations.push(`d.region IN (${f.regions.map(() => "?").join(",")})`)
    binds.push(...f.regions)
  }
  for (const city of f.cities) {
    if (city.startsWith("[")) {
      let pair: unknown
      try {
        pair = JSON.parse(city)
      } catch {
        throw new BuildingError(400, "城市标识无效")
      }
      if (!Array.isArray(pair) || pair.length !== 2 || pair.some(v => typeof v !== "string" || !v || v.length > 100)) throw new BuildingError(400, "城市标识无效")
      locations.push("json_array(d.region,d.city)=?")
      binds.push(JSON.stringify(pair))
    } else {
      locations.push("d.city=?")
      binds.push(city)
    }
  }
  if (locations.length) clauses.push(`(${locations.join(" OR ")})`)
  if (f.types.length) {
    clauses.push(`d.content_type IN (${f.types.map(() => "?").join(",")})`)
    binds.push(...f.types)
  }
  if (f.sources.length) {
    const marks = f.sources.map(() => "?").join(",")
    clauses.push(`(d.source_id IN (${marks}) OR d.source_group IN (${marks}))`)
    binds.push(...f.sources, ...f.sources)
  }
  if (f.importance) {
    clauses.push("d.importance>=?")
    binds.push(f.importance)
  }
  if (f.days) {
    clauses.push("d.published_at>=? AND d.published_at<=?")
    binds.push(at - f.days * 86400000, at + 86400000)
  }
  for (const word of f.q.toLocaleLowerCase().split(/\s+/).filter(Boolean)) {
    clauses.push("instr(d.search_text,?)>0")
    binds.push(word)
  }
  return { where: clauses.join(" AND ") || "1=1", binds }
}
export async function readPage(
  db: BuildingDB,
  params: URLSearchParams,
  now = Date.now(),
  catalog: IntelligenceSource[] = intelligenceSources,
  configs?: PublishedSourceConfig[],
) {
  const q = readQuery(params)
  const state = await buildingMeta(db)
  if (!state.initialized || !state.migrationComplete) throw new BuildingError(503, "资讯库尚未发布")
  const approvedScope = extractApprovedSourceScope(configs)
  const configRevision = configs ? await sourceCatalogRevision(configs) : undefined
  const hash = await buildingHash(JSON.stringify([q.filters, q.limit, configRevision ?? ""]))
  const cursor = q.cursor ? decode(q.cursor) : undefined
  if (cursor && (cursor.revision !== state.revision || cursor.configRevision !== configRevision || cursor.hash !== hash || cursor.at > now + 60000 || cursor.at < now - 86400000)) throw new BuildingError(409, "资讯版本或筛选已更新，请刷新后继续")
  const at = cursor?.at ?? now
  const { where, binds } = conditions(q.filters, at, approvedScope)
  const ranked = q.filters.sort !== "latest"
  const fields = ranked ? ["d.importance", "COALESCE(d.published_at,0)", "d.collected_at", "d.id"] : ["COALESCE(d.published_at,0)", "d.collected_at", "d.id"]
  const last = cursor ? (ranked ? cursor.last : cursor.last.slice(1)) : []
  const continuation = cursor ? ` AND (${fields.join(",")}) < (${last.map(() => "?").join(",")})` : ""

  const scopeFilter = buildApprovedSourceFilter(approvedScope)
  const scopeWhere = scopeFilter.where ? `WHERE ${scopeFilter.where}` : ""
  const scopeBinds = scopeFilter.binds

  const result = await db.batch([
    db.prepare("SELECT * FROM building_meta_v3 WHERE topic='building'"),
    db.prepare(`SELECT COUNT(*) AS n FROM building_docs_v3 d WHERE ${where}`).bind(...binds),
    db.prepare(`SELECT d.data FROM building_docs_v3 d WHERE ${where}${continuation} ORDER BY ${fields.map(f => `${f} DESC`).join(",")} LIMIT ?`).bind(...binds, ...last, q.limit + 1),
    db.prepare(`SELECT category,COUNT(*) AS n FROM building_docs_v3 d ${scopeWhere} GROUP BY category`).bind(...scopeBinds),
    db.prepare(`SELECT DISTINCT region,city FROM building_docs_v3 d ${scopeWhere} ORDER BY region,city`).bind(...scopeBinds),
    db.prepare(`SELECT DISTINCT j.value AS tag FROM building_docs_v3 d,json_each(d.data,'$.tags') j ${scopeWhere} ORDER BY tag LIMIT 1000`).bind(...scopeBinds),
    db.prepare(`SELECT COUNT(*) AS n FROM building_docs_v3 d ${scopeWhere}`).bind(...scopeBinds),
  ])
  if (result[0].results[0].revision !== state.revision) throw new BuildingError(409, "资讯正在更新，请刷新重试")
  const raw = result[2].results.map((r: any) => JSON.parse(r.data))
  const articles = raw.slice(0, q.limit).map(publicArticle)
  const tail = articles[articles.length - 1]
  const nextCursor = raw.length > q.limit && tail ? btoa(JSON.stringify({ revision: state.revision, configRevision, hash, at, last: [tail.importance, tail.publishedAt ?? 0, tail.collectedAt, tail.key] })) : null
  let sources = catalog.filter(isPublishedSource).map(({ id, name, home, group, region, city }) => ({ id, name, home, group, region, city }))
  if (approvedScope) {
    const approvedIds = new Set(approvedScope.map(s => s.sourceId))
    sources = sources.filter(s => approvedIds.has(s.id))
  }
  const grouped = new Map<string, Set<string>>()
  for (const row of [...sources, ...result[4].results]) {
    if (!row.region) continue
    const cities = grouped.get(row.region) ?? new Set<string>()
    if (row.city && row.city !== row.region) cities.add(row.city)
    grouped.set(row.region, cities)
  }
  const locations = [...grouped].sort(([a], [b]) => a === b ? 0 : a === "全国" ? -1 : b === "全国" ? 1 : a.localeCompare(b, "zh-CN")).map(([region, cities]) => ({ region, cities: [...cities].sort((a, b) => a.localeCompare(b, "zh-CN")) }))
  const totalPublished = approvedScope ? result[6].results[0].n : state.total
  const version = configRevision ? `${state.revision}.${configRevision.slice(0, 8)}` : String(state.revision)
  return { topic: "building" as const, version, updatedAt: state.published_at ?? undefined, articles, sources, total: result[1].results[0].n, totalPublished, nextCursor, truncated: false, facets: { categories: Object.fromEntries(result[3].results.map((r: any) => [r.category, r.n])), locations, tags: result[5].results.map((r: any) => ({ id: r.tag, name: r.tag })) } }
}
export async function readVersion(db: BuildingDB, configs?: PublishedSourceConfig[]) {
  const row = await buildingMeta(db)
  if (!row.initialized || !row.migrationComplete) throw new BuildingError(503, "资讯库尚未发布")
  if (!configs) {
    return { topic: "building", version: String(row.revision), updatedAt: row.published_at ?? undefined, totalPublished: row.total }
  }
  const approvedScope = extractApprovedSourceScope(configs)
  const scopeFilter = buildApprovedSourceFilter(approvedScope)
  const scopeWhere = scopeFilter.where ? `WHERE ${scopeFilter.where}` : ""
  const countRow = await db.prepare(`SELECT COUNT(*) AS n FROM building_docs_v3 d ${scopeWhere}`).bind(...scopeFilter.binds).first<{ n: number }>()
  const configRevision = await sourceCatalogRevision(configs)
  const version = `${row.revision}.${configRevision.slice(0, 8)}`
  return { topic: "building", version, updatedAt: row.published_at ?? undefined, totalPublished: countRow?.n ?? 0 }
}
