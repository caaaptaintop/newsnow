from pathlib import Path
import re

root = Path.cwd()


def write(path: str, content: str):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace_once(path: str, old: str, new: str):
    target = root / path
    text = target.read_text(encoding="utf-8")
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f"missing integration marker in {path}: {old[:120]}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


write("server/source-admin/schema.ts", r'''
export interface SourceAdminDB {
  prepare(query: string): any
  batch(statements: any[]): Promise<any[]>
}

export const sourceAdminSchema = [
  `CREATE TABLE IF NOT EXISTS source_config_meta_v1 (
    id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `INSERT OR IGNORE INTO source_config_meta_v1(id) VALUES(1)`,
  `CREATE TABLE IF NOT EXISTS source_config_published_v1 (
    source_id TEXT PRIMARY KEY, topic TEXT NOT NULL, version INTEGER NOT NULL,
    data TEXT NOT NULL CHECK(json_valid(data)), updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS source_config_published_topic_v1 ON source_config_published_v1(topic, source_id)`,
  `CREATE TABLE IF NOT EXISTS source_config_drafts_v1 (
    source_id TEXT PRIMARY KEY, topic TEXT NOT NULL, base_version INTEGER NOT NULL,
    data TEXT NOT NULL CHECK(json_valid(data)), updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS source_config_drafts_topic_v1 ON source_config_drafts_v1(topic, source_id)`,
  `CREATE TABLE IF NOT EXISTS source_config_history_v1 (
    source_id TEXT NOT NULL, version INTEGER NOT NULL, topic TEXT NOT NULL,
    data TEXT NOT NULL CHECK(json_valid(data)), published_at INTEGER NOT NULL,
    published_by TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY(source_id, version)
  )`,
  `CREATE INDEX IF NOT EXISTS source_config_history_topic_v1 ON source_config_history_v1(topic, published_at DESC)`,
  `CREATE TABLE IF NOT EXISTS source_config_tests_v1 (
    source_id TEXT PRIMARY KEY, config_hash TEXT NOT NULL, tested_at INTEGER NOT NULL,
    tested_by TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))
  )`,
  `CREATE TABLE IF NOT EXISTS source_config_guards_v1 (
    id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1)
  )`,
]

let initialization: Promise<void> | undefined
export function ensureSourceAdminSchema(db: SourceAdminDB) {
  initialization ??= db.batch(sourceAdminSchema.map(statement => db.prepare(statement))).then(() => undefined).catch((error) => {
    initialization = undefined
    throw error
  })
  return initialization
}
''')

write("server/source-admin/model.ts", r'''
import { BuildingError } from "../../shared/building-contract"
import { sourceEndpointKinds, type ManagedSourceConfig, type SourceCollectionMode } from "../../shared/source-config"

const topics = new Set(["building", "ai", "finance", "health"])
const modes = new Set<SourceCollectionMode>(["explicit", "legacy-discovery", "feed"])

function safePublicUrl(value: unknown, label: string) {
  if (typeof value !== "string" || value.length > 2048) throw new BuildingError(400, `${label}无效`)
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new BuildingError(400, `${label}无效`) }
  if (!/^https?:$/.test(url.protocol) || (url.port && !["80", "443"].includes(url.port))) throw new BuildingError(400, `${label}只允许HTTP或HTTPS标准端口`)
  const host = url.hostname.toLowerCase().replace(/^www\./, "")
  if (!host.includes(".") || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    throw new BuildingError(400, `${label}不得指向本机或IP地址`)
  }
  url.username = ""
  url.password = ""
  url.hash = ""
  return url.href
}

export function normalizeManagedSourceConfig(input: unknown, options: { allowLegacyDiscovery?: boolean } = {}): ManagedSourceConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new BuildingError(400, "信息源配置无效")
  const value = input as Record<string, any>
  const id = typeof value.id === "string" ? value.id.trim() : ""
  if (!/^[a-z0-9][a-z0-9-]{2,100}$/.test(id)) throw new BuildingError(400, "信息源编号无效")
  if (!topics.has(value.topic)) throw new BuildingError(400, "信息源主题无效")
  const text = (key: string, max: number, optional = false) => {
    const result = typeof value[key] === "string" ? value[key].trim() : ""
    if ((!optional && !result) || result.length > max) throw new BuildingError(400, `${key}无效`)
    return result
  }
  const home = safePublicUrl(value.home, "官网地址")
  const approvedHost = new URL(home).hostname.toLowerCase().replace(/^www\./, "")
  if (!modes.has(value.collectionMode)) throw new BuildingError(400, "采集模式无效")
  if (value.collectionMode === "legacy-discovery" && !options.allowLegacyDiscovery) throw new BuildingError(400, "自动发现只用于寻找候选栏目，不能作为新的生产配置发布")
  if (!Array.isArray(value.endpoints) || value.endpoints.length > 12) throw new BuildingError(400, "采集栏目数量无效")
  const endpointIds = new Set<string>()
  const endpointUrls = new Set<string>()
  const endpoints = value.endpoints.map((endpoint: any) => {
    if (!endpoint || typeof endpoint !== "object") throw new BuildingError(400, "采集栏目无效")
    const endpointId = typeof endpoint.id === "string" ? endpoint.id.trim() : ""
    if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(endpointId) || endpointIds.has(endpointId)) throw new BuildingError(400, "采集栏目编号重复或无效")
    endpointIds.add(endpointId)
    if (!sourceEndpointKinds.includes(endpoint.kind)) throw new BuildingError(400, "采集栏目类型无效")
    const name = typeof endpoint.name === "string" ? endpoint.name.trim() : ""
    if (!name || name.length > 80) throw new BuildingError(400, "采集栏目名称无效")
    const url = safePublicUrl(endpoint.url, "采集栏目地址")
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "")
    if (host !== approvedHost) throw new BuildingError(400, "采集栏目必须与官网使用同一主机；换域名时请先更新官网")
    const canonical = new URL(url)
    canonical.searchParams.sort()
    const urlKey = canonical.href
    if (endpointUrls.has(urlKey)) throw new BuildingError(400, "采集栏目地址重复")
    endpointUrls.add(urlKey)
    return { id: endpointId, kind: endpoint.kind, name, url, enabled: endpoint.enabled !== false }
  })
  const collectionMode = value.collectionMode as SourceCollectionMode
  const newsnowId = typeof value.newsnowId === "string" ? value.newsnowId.trim() : undefined
  if (collectionMode === "feed" && !newsnowId) throw new BuildingError(400, "平台信息源缺少适配器编号")
  if (collectionMode === "explicit" && !endpoints.some(endpoint => endpoint.enabled)) throw new BuildingError(400, "明确栏目模式至少需要一个启用栏目")
  const priority = Number(value.priority)
  if (!Number.isSafeInteger(priority) || priority < 0 || priority > 1000) throw new BuildingError(400, "优先级无效")
  return {
    id,
    topic: value.topic,
    name: text("name", 160),
    home,
    group: text("group", 80),
    level: text("level", 40),
    region: text("region", 40, true),
    city: text("city", 40, true),
    priority,
    enabled: value.enabled !== false,
    collectionMode,
    endpoints,
    ...(newsnowId ? { newsnowId } : {}),
  }
}

export function parseStoredConfig(value: unknown) {
  try { return normalizeManagedSourceConfig(typeof value === "string" ? JSON.parse(value) : value, { allowLegacyDiscovery: true }) }
  catch { return undefined }
}
''')

write("server/source-admin/store.ts", r'''
import type { IntelligenceTopic } from "../../shared/intelligence"
import { intelligenceSources } from "../../shared/official-sources"
import { sourceConfigFromIntelligenceSource, sourceConfigurationStatus, type ManagedSourceConfig, type SourceConfigSnapshot } from "../../shared/source-config"
import { BuildingError } from "../../shared/building-contract"
import type { BuildingDB } from "../building/store"
import { normalizeManagedSourceConfig, parseStoredConfig } from "./model"
import { ensureSourceAdminSchema } from "./schema"

const topicNames: Record<string, string> = { building: "建筑", ai: "AI", finance: "财经", health: "健康" }
const topicOrder = ["building", "ai", "finance", "health"]
const testValidityMs = 24 * 60 * 60 * 1000

interface PublishedRow { source_id: string, topic: string, version: number, data: string, updated_at: number, updated_by: string }
interface DraftRow { source_id: string, topic: string, base_version: number, data: string, updated_at: number, updated_by: string, note: string }
interface TestRow { source_id: string, config_hash: string, tested_at: number, tested_by: string, data: string }

function seeds() {
  return intelligenceSources.map(sourceConfigFromIntelligenceSource)
}

async function configHash(config: ManagedSourceConfig) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(config)))
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("")
}

async function configMeta(db: BuildingDB) {
  await ensureSourceAdminSchema(db)
  const row = await db.prepare("SELECT revision,updated_at FROM source_config_meta_v1 WHERE id=1").first<{ revision: number, updated_at: number }>()
  if (!row) throw new BuildingError(503, "信息源配置库尚未初始化")
  return row
}

async function publishedRows(db: BuildingDB, topic?: string) {
  await ensureSourceAdminSchema(db)
  const result = topic
    ? await db.prepare("SELECT * FROM source_config_published_v1 WHERE topic=? ORDER BY source_id").bind(topic).all<PublishedRow>()
    : await db.prepare("SELECT * FROM source_config_published_v1 ORDER BY topic,source_id").all<PublishedRow>()
  return result.results ?? []
}

export async function sourceConfigSnapshot(db: BuildingDB, topic: IntelligenceTopic): Promise<SourceConfigSnapshot> {
  const meta = await configMeta(db)
  const map = new Map(seeds().filter(source => source.topic === topic).map(source => [source.id, source]))
  for (const row of await publishedRows(db, topic)) {
    const config = parseStoredConfig(row.data)
    if (config && config.topic === topic) map.set(config.id, config)
  }
  return {
    schemaVersion: 1,
    revision: meta.revision,
    generatedAt: meta.updated_at,
    topic,
    sources: [...map.values()].sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name, "zh-CN")),
  }
}

function issueText(state: any) {
  if (!state) return "尚无运行记录"
  if (typeof state.error === "string" && state.error) return state.error
  if (Array.isArray(state.warnings) && state.warnings.length) return state.warnings[0]
  if (typeof state.message === "string" && state.message) return state.message
  return state.status === "ok" ? "—" : "本轮存在未完成项"
}

function endpointHealth(config: ManagedSourceConfig, state: any) {
  const warnings = Array.isArray(state?.warnings) ? state.warnings.map(String) : []
  return config.endpoints.map(endpoint => {
    const warning = warnings.find((item: string) => item.includes(endpoint.name))
    return {
      ...endpoint,
      status: warning ? "partial" : state?.status === "ok" ? "ok" : "unknown",
      issue: warning || "",
    }
  })
}

export async function sourceAdminDashboard(db: BuildingDB) {
  const meta = await configMeta(db)
  const published = await publishedRows(db)
  const publishedMap = new Map(published.map(row => [row.source_id, row]))
  const drafts = (await db.prepare("SELECT * FROM source_config_drafts_v1 ORDER BY topic,source_id").all<DraftRow>()).results ?? []
  const draftMap = new Map(drafts.map(row => [row.source_id, row]))
  const tests = (await db.prepare("SELECT * FROM source_config_tests_v1").all<TestRow>()).results ?? []
  const testMap = new Map(tests.map(row => [row.source_id, row]))
  const legacyRows = (await db.prepare("SELECT id,data,checked_at FROM building_sources_v3").all<any>()).results ?? []
  const legacyMap = new Map(legacyRows.map(row => [row.id, row]))
  const map = new Map(seeds().map(source => [source.id, source]))
  for (const row of published) {
    const config = parseStoredConfig(row.data)
    if (config) map.set(config.id, config)
  }
  for (const row of drafts) {
    if (map.has(row.source_id)) continue
    const config = parseStoredConfig(row.data)
    if (config) map.set(config.id, config)
  }
  const sources = [...map.values()].map(config => {
    const publishedRow = publishedMap.get(config.id)
    const draftRow = draftMap.get(config.id)
    const testRow = testMap.get(config.id)
    const legacy: any = legacyMap.get(config.id)
    let state: any
    let testData: any
    try { state = legacy ? JSON.parse(legacy.data) : undefined } catch { state = undefined }
    try { testData = testRow ? JSON.parse(testRow.data) : undefined } catch { testData = undefined }
    const status = state?.status ?? "unknown"
    const checkedAt = legacy?.checked_at ?? state?.checkedAt ?? null
    return {
      config,
      publishedVersion: publishedRow?.version ?? 0,
      publishedAt: publishedRow?.updated_at ?? null,
      hasDraft: Boolean(draftRow),
      draftUpdatedAt: draftRow?.updated_at ?? null,
      configurationStatus: draftRow ? "draft" : sourceConfigurationStatus(config),
      testedAt: testRow?.tested_at ?? null,
      testPassed: Boolean(testRow && testRow.tested_at >= Date.now() - testValidityMs && testData?.ok === true),
      health: {
        status,
        checkedAt,
        lastSuccessAt: status !== "error" ? checkedAt : null,
        lastErrorAt: status === "error" ? checkedAt : null,
        consecutiveFailures: status === "error" ? 1 : 0,
        issue: issueText(state),
        candidateCount: state?.candidateCount ?? state?.candidates ?? null,
        acceptedCount: state?.acceptedCount ?? state?.accepted ?? null,
      },
      endpoints: endpointHealth(config, state),
    }
  })
  const topics = topicOrder.map(id => {
    const entries = sources.filter(item => item.config.topic === id)
    const countBy = (value: string) => entries.filter(item => item.health.status === value).length
    return {
      id,
      name: topicNames[id] ?? id,
      sourceCount: entries.length,
      publicEnabled: id === "building",
      counts: {
        ok: countBy("ok"),
        partial: countBy("partial"),
        error: countBy("error"),
        unconfigured: entries.filter(item => sourceConfigurationStatus(item.config) === "unconfigured").length,
      },
    }
  })
  return { revision: meta.revision, updatedAt: meta.updated_at, topics, sources }
}

export async function sourceAdminDetail(db: BuildingDB, sourceId: string) {
  const dashboard = await sourceAdminDashboard(db)
  const source = dashboard.sources.find(item => item.config.id === sourceId)
  if (!source) throw new BuildingError(404, "信息源不存在")
  const draftRow = await db.prepare("SELECT * FROM source_config_drafts_v1 WHERE source_id=?").bind(sourceId).first<DraftRow>()
  const testRow = await db.prepare("SELECT * FROM source_config_tests_v1 WHERE source_id=?").bind(sourceId).first<TestRow>()
  const history = ((await db.prepare("SELECT source_id,version,topic,data,published_at,published_by,note FROM source_config_history_v1 WHERE source_id=? ORDER BY version DESC LIMIT 20").bind(sourceId).all<any>()).results ?? []).map(row => ({
    version: row.version,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    note: row.note,
    config: parseStoredConfig(row.data),
  }))
  let testData: any
  try { testData = testRow ? JSON.parse(testRow.data) : null } catch { testData = null }
  return {
    ...source,
    draft: draftRow ? {
      baseVersion: draftRow.base_version,
      updatedAt: draftRow.updated_at,
      updatedBy: draftRow.updated_by,
      note: draftRow.note,
      config: parseStoredConfig(draftRow.data),
    } : null,
    test: testRow ? {
      testedAt: testRow.tested_at,
      testedBy: testRow.tested_by,
      validUntil: testRow.tested_at + testValidityMs,
      result: testData,
    } : null,
    history,
  }
}

export async function saveSourceDraft(db: BuildingDB, actor: string, body: any) {
  await ensureSourceAdminSchema(db)
  const config = normalizeManagedSourceConfig(body?.config)
  const current = await db.prepare("SELECT version FROM source_config_published_v1 WHERE source_id=?").bind(config.id).first<{ version: number }>()
  const currentVersion = current?.version ?? 0
  if (!Number.isSafeInteger(body?.baseVersion) || body.baseVersion !== currentVersion) throw new BuildingError(409, "信息源配置基线已变化，请刷新后重试")
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : ""
  const now = Date.now()
  await db.batch([
    db.prepare(`INSERT INTO source_config_drafts_v1(source_id,topic,base_version,data,updated_at,updated_by,note)
      VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET topic=excluded.topic,base_version=excluded.base_version,
      data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by,note=excluded.note`).bind(config.id, config.topic, currentVersion, JSON.stringify(config), now, actor, note),
    db.prepare("DELETE FROM source_config_tests_v1 WHERE source_id=?").bind(config.id),
  ])
  return { saved: true, sourceId: config.id, baseVersion: currentVersion, updatedAt: now, config }
}

export async function recordSourceTest(db: BuildingDB, actor: string, configInput: unknown, result: any) {
  await ensureSourceAdminSchema(db)
  const config = normalizeManagedSourceConfig(configInput)
  const data = JSON.stringify(config)
  const hash = await configHash(config)
  const now = Date.now()
  const guard = crypto.randomUUID()
  try {
    await db.batch([
      db.prepare(`INSERT INTO source_config_guards_v1 VALUES(?,CASE WHEN
        EXISTS(SELECT 1 FROM source_config_drafts_v1 WHERE source_id=? AND data=?)
        THEN 1 ELSE 0 END)`).bind(guard, config.id, data),
      db.prepare(`INSERT INTO source_config_tests_v1(source_id,config_hash,tested_at,tested_by,data) VALUES(?,?,?,?,?)
        ON CONFLICT(source_id) DO UPDATE SET config_hash=excluded.config_hash,tested_at=excluded.tested_at,
        tested_by=excluded.tested_by,data=excluded.data`).bind(config.id, hash, now, actor, JSON.stringify(result)),
      db.prepare("DELETE FROM source_config_guards_v1 WHERE id=?").bind(guard),
    ])
  } catch {
    throw new BuildingError(409, "测试期间草稿已变化，请重新测试")
  }
  return { tested: true, testedAt: now, validUntil: now + testValidityMs }
}

export async function publishSourceDraft(db: BuildingDB, actor: string, body: any) {
  await ensureSourceAdminSchema(db)
  const sourceId = typeof body?.sourceId === "string" ? body.sourceId : ""
  const draft = await db.prepare("SELECT * FROM source_config_drafts_v1 WHERE source_id=?").bind(sourceId).first<DraftRow>()
  if (!draft) throw new BuildingError(404, "没有可发布的草稿")
  const config = parseStoredConfig(draft.data)
  if (!config || config.collectionMode === "legacy-discovery") throw new BuildingError(409, "草稿内容无效")
  const test = await db.prepare("SELECT * FROM source_config_tests_v1 WHERE source_id=?").bind(sourceId).first<TestRow>()
  const hash = await configHash(config)
  if (!test || test.config_hash !== hash || test.tested_at < Date.now() - testValidityMs) throw new BuildingError(409, "当前草稿尚未完成有效的全量测试")
  let testData: any
  try { testData = JSON.parse(test.data) } catch { testData = undefined }
  if (testData?.ok !== true) throw new BuildingError(409, "当前草稿测试未通过")
  const meta = await configMeta(db)
  if (!Number.isSafeInteger(body?.baseRevision) || body.baseRevision !== meta.revision) throw new BuildingError(409, "信息源配置总版本已变化，请刷新后重试")
  const current = await db.prepare("SELECT version FROM source_config_published_v1 WHERE source_id=?").bind(sourceId).first<{ version: number }>()
  const currentVersion = current?.version ?? 0
  if (draft.base_version !== currentVersion) throw new BuildingError(409, "草稿基线已过期，请重新保存")
  const version = currentVersion + 1
  const now = Date.now()
  const guard = crypto.randomUUID()
  try {
    await db.batch([
      db.prepare(`INSERT INTO source_config_guards_v1 VALUES(?,CASE WHEN
        (SELECT revision FROM source_config_meta_v1 WHERE id=1)=? AND
        COALESCE((SELECT version FROM source_config_published_v1 WHERE source_id=?),0)=? AND
        EXISTS(SELECT 1 FROM source_config_drafts_v1 WHERE source_id=? AND base_version=? AND data=?) AND
        EXISTS(SELECT 1 FROM source_config_tests_v1 WHERE source_id=? AND config_hash=? AND tested_at=?)
        THEN 1 ELSE 0 END)`).bind(guard, meta.revision, sourceId, currentVersion, sourceId, currentVersion, draft.data, sourceId, hash, test.tested_at),
      db.prepare("INSERT INTO source_config_history_v1(source_id,version,topic,data,published_at,published_by,note) VALUES(?,?,?,?,?,?,?)").bind(sourceId, version, config.topic, draft.data, now, actor, draft.note),
      db.prepare(`INSERT INTO source_config_published_v1(source_id,topic,version,data,updated_at,updated_by) VALUES(?,?,?,?,?,?)
        ON CONFLICT(source_id) DO UPDATE SET topic=excluded.topic,version=excluded.version,data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(sourceId, config.topic, version, draft.data, now, actor),
      db.prepare("DELETE FROM source_config_drafts_v1 WHERE source_id=?").bind(sourceId),
      db.prepare("DELETE FROM source_config_tests_v1 WHERE source_id=?").bind(sourceId),
      db.prepare("UPDATE source_config_meta_v1 SET revision=?,updated_at=? WHERE id=1").bind(meta.revision + 1, now),
      db.prepare("DELETE FROM source_config_guards_v1 WHERE id=?").bind(guard),
    ])
  } catch {
    throw new BuildingError(409, "信息源配置发布冲突，请刷新后重试")
  }
  return { published: true, sourceId, version, revision: meta.revision + 1, publishedAt: now }
}

export async function restoreSourceHistory(db: BuildingDB, actor: string, body: any) {
  await ensureSourceAdminSchema(db)
  const sourceId = typeof body?.sourceId === "string" ? body.sourceId : ""
  const version = Number(body?.version)
  if (!Number.isSafeInteger(version) || version < 1) throw new BuildingError(400, "历史版本无效")
  const row = await db.prepare("SELECT data FROM source_config_history_v1 WHERE source_id=? AND version=?").bind(sourceId, version).first<{ data: string }>()
  const config = row ? parseStoredConfig(row.data) : undefined
  if (!config) throw new BuildingError(404, "历史版本不存在")
  const current = await db.prepare("SELECT version FROM source_config_published_v1 WHERE source_id=?").bind(sourceId).first<{ version: number }>()
  return saveSourceDraft(db, actor, { config, baseVersion: current?.version ?? 0, note: `恢复自版本 ${version}` })
}
''')

write("server/source-admin/test-source.ts", r'''
import type { ManagedSourceConfig } from "../../shared/source-config"
import { inferSourceEndpointKind, sourceConfigToIntelligenceSource } from "../../shared/source-config"
import { BuildingError } from "../../shared/building-contract"
import { collectSource } from "../utils/intelligence-collector"
import { intelligenceDiscoverColumns, intelligenceFetchHtml, intelligenceParseArticle } from "../utils/intelligence-parser"
import { normalizeManagedSourceConfig } from "./model"

export async function discoverSourceEndpoints(input: unknown) {
  const config = normalizeManagedSourceConfig(input, { allowLegacyDiscovery: true })
  const source = sourceConfigToIntelligenceSource({ ...config, collectionMode: "legacy-discovery", endpoints: [] })
  const homepage = await intelligenceFetchHtml(source.home, source)
  return intelligenceDiscoverColumns(homepage.html, source, homepage.url, 12).map((column, index) => ({
    id: `candidate-${index + 1}`,
    kind: inferSourceEndpointKind(column.name),
    name: column.name,
    url: column.url,
    enabled: true,
  }))
}

async function inspectSample(config: ManagedSourceConfig, item: any) {
  const source = sourceConfigToIntelligenceSource(config)
  try {
    const page = await intelligenceFetchHtml(item.url, source)
    const article = intelligenceParseArticle(page.html, item, source)
    return { title: article.title, url: article.url, publishedAt: article.publishedAt ?? null, attachments: article.attachments.slice(0, 5) }
  } catch (error: any) {
    return { title: item.title, url: item.url, publishedAt: item.publishedAt ?? null, attachments: [], warning: String(error?.message || error) }
  }
}

export async function testSourceConfiguration(input: unknown, endpointId?: string) {
  const config = normalizeManagedSourceConfig(input)
  if (config.collectionMode === "legacy-discovery") throw new BuildingError(400, "请先选择并固化候选栏目")
  const enabled = config.endpoints.filter(endpoint => endpoint.enabled)
  const targets = config.collectionMode === "feed"
    ? [{ id: "feed", name: "平台适配器", config }]
    : enabled.filter(endpoint => !endpointId || endpoint.id === endpointId).map(endpoint => ({
        id: endpoint.id,
        name: endpoint.name,
        config: { ...config, endpoints: [{ ...endpoint, enabled: true }] },
      }))
  if (!targets.length) throw new BuildingError(400, "待测试栏目不存在")
  const endpointResults: any[] = []
  const samples: any[] = []
  for (const target of targets) {
    try {
      const collected = await collectSource(sourceConfigToIntelligenceSource(target.config))
      if (!collected.items.length) throw new Error("未识别到文章")
      const sample = await inspectSample(target.config, collected.items[0])
      if (samples.length < 6) samples.push(sample)
      endpointResults.push({
        id: target.id,
        name: target.name,
        ok: true,
        candidateCount: collected.items.length,
        datedCount: collected.items.filter(item => Number.isFinite(item.publishedAt)).length,
        warnings: collected.warnings,
      })
    } catch (error: any) {
      endpointResults.push({ id: target.id, name: target.name, ok: false, candidateCount: 0, datedCount: 0, warnings: [String(error?.message || error)] })
    }
  }
  const failed = endpointResults.filter(result => !result.ok)
  if (failed.length) throw new BuildingError(422, failed.map(result => `${result.name}：${result.warnings[0]}`).join("；"))
  return {
    ok: true,
    endpointResults,
    candidateCount: endpointResults.reduce((sum, result) => sum + result.candidateCount, 0),
    datedCount: endpointResults.reduce((sum, result) => sum + result.datedCount, 0),
    sampleAttachments: samples.reduce((sum, item) => sum + item.attachments.length, 0),
    warnings: endpointResults.flatMap(result => result.warnings),
    samples,
  }
}
''')

write("server/source-admin/access.ts", r'''
import { createError, getHeader, getRequestURL } from "h3"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { buildingEnv } from "../building/store"

const keySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

export async function requireSourceAdmin(event: any, write = false) {
  const env = buildingEnv(event)
  const rawDomain = typeof env.SOURCE_ADMIN_ACCESS_TEAM_DOMAIN === "string" ? env.SOURCE_ADMIN_ACCESS_TEAM_DOMAIN.trim() : ""
  const domain = rawDomain.replace(/^https?:\/\//, "").replace(/\/$/, "").toLowerCase()
  const audience = typeof env.SOURCE_ADMIN_ACCESS_AUD === "string" ? env.SOURCE_ADMIN_ACCESS_AUD.trim() : ""
  if (!/^[a-z0-9.-]+\.cloudflareaccess\.com$/.test(domain) || !audience) {
    throw createError({ statusCode: 404, message: "信息源管理中心尚未配置访问保护" })
  }
  if (write) {
    const origin = getHeader(event, "origin")
    if (origin) {
      try {
        if (new URL(origin).host !== getRequestURL(event).host) throw new Error("cross-origin")
      } catch { throw createError({ statusCode: 403, message: "拒绝跨站管理请求" }) }
    }
  }
  const token = getHeader(event, "cf-access-jwt-assertion") ?? ""
  if (!token) throw createError({ statusCode: 401, message: "需要通过受保护的管理入口访问" })
  try {
    let jwks = keySets.get(domain)
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`))
      keySets.set(domain, jwks)
    }
    const { payload } = await jwtVerify(token, jwks, { issuer: `https://${domain}`, audience })
    const email = typeof payload.email === "string" ? payload.email.toLowerCase() : ""
    const allowed = typeof env.SOURCE_ADMIN_ALLOWED_EMAILS === "string"
      ? env.SOURCE_ADMIN_ALLOWED_EMAILS.split(",").map((item: string) => item.trim().toLowerCase()).filter(Boolean)
      : []
    if (allowed.length && (!email || !allowed.includes(email))) throw createError({ statusCode: 403, message: "当前账号没有信息源管理权限" })
    return { actor: email || String(payload.sub || "cloudflare-access"), email }
  } catch (error: any) {
    if (error?.statusCode) throw error
    throw createError({ statusCode: 401, message: "管理身份验证失败" })
  }
}
''')

write("server/api/intelligence/source-config.get.ts", r'''
import { createError, defineEventHandler, getQuery, setHeader } from "h3"
import { buildingDB } from "../../building/store"
import { sourceConfigSnapshot } from "../../source-admin/store"

export default defineEventHandler(async (event) => {
  const topic = String(getQuery(event).topic || "building")
  if (topic !== "building") throw createError({ statusCode: 404, message: "该主题暂未开放" })
  setHeader(event, "Cache-Control", "public, max-age=60, stale-while-revalidate=300")
  return sourceConfigSnapshot(buildingDB(event), "building")
})
''')

write("server/api/internal/source-admin.get.ts", r'''
import { defineEventHandler, getQuery, setHeader } from "h3"
import { buildingDB } from "../../building/store"
import { requireSourceAdmin } from "../../source-admin/access"
import { sourceAdminDashboard, sourceAdminDetail } from "../../source-admin/store"

export default defineEventHandler(async (event) => {
  await requireSourceAdmin(event)
  setHeader(event, "Cache-Control", "no-store")
  const query = getQuery(event)
  const sourceId = typeof query.sourceId === "string" ? query.sourceId : ""
  return sourceId ? sourceAdminDetail(buildingDB(event), sourceId) : sourceAdminDashboard(buildingDB(event))
})
''')

write("server/api/internal/source-admin.post.ts", r'''
import { createError, defineEventHandler, getHeader, readBody, setHeader } from "h3"
import { buildingDB } from "../../building/store"
import { requireSourceAdmin } from "../../source-admin/access"
import { publishSourceDraft, recordSourceTest, restoreSourceHistory, saveSourceDraft } from "../../source-admin/store"
import { discoverSourceEndpoints, testSourceConfiguration } from "../../source-admin/test-source"

export default defineEventHandler(async (event) => {
  if (!/^application\/json(?:;|$)/i.test(getHeader(event, "content-type") || "")) throw createError({ statusCode: 415, message: "只接受JSON请求" })
  const { actor } = await requireSourceAdmin(event, true)
  setHeader(event, "Cache-Control", "no-store")
  const body = await readBody(event)
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") throw createError({ statusCode: 400, message: "管理操作无效" })
  const db = buildingDB(event)
  switch (body.action) {
    case "save-draft": return saveSourceDraft(db, actor, body)
    case "publish": return publishSourceDraft(db, actor, body)
    case "restore-history": return restoreSourceHistory(db, actor, body)
    case "discover": return { candidates: await discoverSourceEndpoints(body.config) }
    case "test": {
      if (typeof body.endpointId === "string") return testSourceConfiguration(body.config, body.endpointId)
      const saved = await saveSourceDraft(db, actor, body)
      const result = await testSourceConfiguration(saved.config)
      const receipt = await recordSourceTest(db, actor, saved.config, result)
      return { ...result, ...receipt, draftSaved: true }
    }
    default: throw createError({ statusCode: 400, message: "不支持的管理操作" })
  }
})
''')

write("server/utils/intelligence-collector.ts", r'''
import { hackernewsFeed } from "./hackernews-feed"
import type { IntelligenceSource } from "../../shared/intelligence"
import { intelligenceCanonicalUrl, intelligenceDate } from "../../shared/intelligence"
import { intelligenceDiscoverColumns, intelligenceFetchHtml, intelligenceParseList } from "./intelligence-parser"

/** An unreadable column must not become an empty success. */
async function collect(source: IntelligenceSource & { collectionMode?: string }) {
  const warnings: string[] = []
  if (source.newsnowId === "hackernews") {
    const items = await hackernewsFeed()
    return { columns: [{ name: "Hacker News 官方 API", url: "https://github.com/HackerNews/API" }], warnings, items: items.map(item => ({ title: item.title, url: item.url, column: "热点与快讯", publishedAt: intelligenceDate(item.pubDate) })) }
  }
  if (source.newsnowId) {
    const response = await fetch(`https://news.capx-ai.com/api/s?id=${encodeURIComponent(source.newsnowId)}&limit=30`, { signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`热榜读取失败（HTTP ${response.status}）`)
    const feed: any = await response.json()
    if (!Array.isArray(feed.items) || !feed.items.length) throw new Error("未返回新闻，不能视为采集成功")
    return { columns: [{ name: "热点与快讯", url: source.home }], warnings, items: feed.items.map((item: any) => ({ title: item.title, url: item.url, column: "热点与快讯", publishedAt: intelligenceDate(item.pubDate) })) }
  }
  let homepage
  let columns = source.columns ?? []
  const explicit = source.collectionMode === "explicit"
  if (explicit && !columns.length) throw new Error("来源尚未配置启用的采集栏目")
  if (!columns.length) {
    homepage = await intelligenceFetchHtml(source.home, source)
    columns = intelligenceDiscoverColumns(homepage.html, source, homepage.url)
  }
  const items: any[] = []
  for (const column of columns.slice(0, explicit ? 12 : 4)) {
    try {
      const page = await intelligenceFetchHtml(column.url, source)
      const parsed = intelligenceParseList(page.html, source, { ...column, url: page.url })
      if (!parsed.length) warnings.push(`${column.name}：栏目未解析到文章`)
      items.push(...parsed)
    } catch (error: any) {
      warnings.push(`${column.name}：${error.message}`)
    }
  }
  if (!items.length && !explicit) {
    homepage ??= await intelligenceFetchHtml(source.home, source)
    const column = { name: "官网首页公开文章", url: homepage.url }
    const parsed = intelligenceParseList(homepage.html, source, column)
    if (parsed.length) {
      items.push(...parsed)
      columns = [...columns, column]
      warnings.push("专门栏目尚未完整适配，本轮仅读取首页公开文章")
    }
  }
  if (!items.length) throw new Error(warnings.join("；") || "未解析到文章，需要专用栏目适配")
  return { columns, warnings, items: [...new Map(items.map(item => [intelligenceCanonicalUrl(item.url), item])).values()] }
}

export async function collectSource(source: IntelligenceSource & { collectionMode?: string }) {
  try {
    return await collect(source)
  } catch (error: any) {
    const code = error.cause?.code ?? error.code
    if (code === "ENOTFOUND") throw new Error("来源域名无法解析，需要核对官网地址")
    if (String(code).startsWith("ERR_TLS") || String(code).startsWith("ERR_SSL")) throw new Error(`官网安全连接失败（${code}），未降低证书或加密校验`)
    throw error
  }
}
''')

# Preserve the existing UI implementation and change its workflow from
# save-and-publish to save/test receipt/publish.
ui = root / "src/components/source-admin/index.tsx"
text = ui.read_text(encoding="utf-8")
text = text.replace(
  'const updateWorking = (patch: Partial<ManagedSourceConfig>) => setEditor((current: any) => ({ ...current, working: { ...current.working, ...patch } }))',
  'const updateWorking = (patch: Partial<ManagedSourceConfig>) => { setTestResult(null); setEditor((current: any) => ({ ...current, test: null, working: { ...current.working, ...patch } })) }',
)
text = text.replace(
  'try { setTestResult(await post({ action: "test", config: editor.working, endpointId })) }',
  'try {\n      const result = await post({ action: "test", config: editor.working, endpointId, baseVersion: editor.publishedVersion, note: editor.note })\n      setTestResult(result)\n      if (!endpointId) {\n        const detail = await request(`/api/internal/source-admin?sourceId=${encodeURIComponent(editor.working.id)}`)\n        setEditor({ ...detail, working: structuredClone(detail.draft?.config ?? detail.config), note: detail.draft?.note ?? "" })\n        await load()\n      }\n    }',
)
old_publish = '''      await post({ action: "save-draft", config: editor.working, baseVersion: editor.publishedVersion, note: editor.note })
      await post({ action: "publish", sourceId: editor.working.id, baseRevision: dashboard.revision })'''
text = text.replace(old_publish, '      await post({ action: "publish", sourceId: editor.working.id, baseRevision: dashboard.revision })')
text = text.replace(
  '<button onClick={() => void publish()} disabled={busy}>发布配置</button>',
  '<button onClick={() => void publish()} disabled={busy || !editor.test || editor.test.validUntil < Date.now()} title={!editor.test ? "请先执行测试全部" : ""}>发布配置</button>',
)
text = text.replace(
  '<div className="form-grid">',
  '<div className="form-grid">\n          <label><span>启用状态</span><select value={editor.working.enabled ? "enabled" : "disabled"} onChange={event => updateWorking({ enabled: event.target.value === "enabled" })}><option value="enabled">启用</option><option value="disabled">停用</option></select></label>\n          <label><span>来源分组</span><input value={editor.working.group} onChange={event => updateWorking({ group: event.target.value })}/></label>',
  1,
)
text = text.replace(
  '<h3>测试结果</h3>',
  '<h3>测试结果{testResult.testedAt ? " · 已取得发布测试凭据" : ""}</h3>',
)
ui.write_text(text, encoding="utf-8")

# Parser discovery is a diagnostic aid: production keeps the historical limit,
# while the admin screen may show up to twelve candidates for explicit choice.
parser = root / "server/utils/intelligence-parser.ts"
text = parser.read_text(encoding="utf-8")
text = text.replace(
  'export function intelligenceDiscoverColumns(html: string, source: IntelligenceSource, base = source.home) {',
  'export function intelligenceDiscoverColumns(html: string, source: IntelligenceSource, base = source.home, limit = 4) {',
)
text = text.replace('  return found.slice(0, 4)\n}\nexport function intelligenceParseList', '  return found.slice(0, limit)\n}\nexport function intelligenceParseList')
parser.write_text(text, encoding="utf-8")

# One shared collector implementation.
write("tools/ai-bridge/collect-source.ts", 'export { collectSource } from "../../server/utils/intelligence-collector"')

# Existing server integration, written idempotently.
store = root / "server/building/store.ts"
text = store.read_text(encoding="utf-8")
if 'import { sourceAdminSchema } from "../source-admin/schema"' not in text:
    marker = 'import { isPublishedSource } from "../../shared/public-site"'
    if marker not in text:
        raise RuntimeError("building store public-site import changed")
    text = text.replace(marker, marker + '\nimport { sourceAdminSchema } from "../source-admin/schema"\nimport { sourceConfigSnapshot } from "../source-admin/store"', 1)
if '...sourceAdminSchema,' not in text:
    marker = "export const buildingSchema = ["
    if marker not in text:
        raise RuntimeError("building schema declaration changed")
    text = text.replace(marker, marker + "\n  ...sourceAdminSchema,", 1)
old_allowed = "const allowed=new Set(intelligenceSources.filter(isPublishedSource).map(s=>s.id))"
new_allowed = 'const configured=await sourceConfigSnapshot(db,"building")\n  const allowed=new Set(configured.sources.filter(isPublishedSource).map(source=>source.id))'
if new_allowed not in text:
    if old_allowed not in text:
        raise RuntimeError("building source allowlist changed")
    text = text.replace(old_allowed, new_allowed, 1)
store.write_text(text, encoding="utf-8")

replace_once(
    "shared/public-site.ts",
    'if (path === "/api/intelligence" || path === "/api/intelligence/version") return method === "GET" || method === "HEAD"',
    'if (path === "/api/intelligence" || path === "/api/intelligence/version" || path === "/api/intelligence/source-config") return method === "GET" || method === "HEAD"',
)
replace_once(
    "server/middleware/00-public-site.ts",
    'publicApiAllowed(path, event.method) || (path === "/api/internal/building" && event.method === "POST")',
    'publicApiAllowed(path, event.method) || (path === "/api/internal/building" && event.method === "POST") || (path === "/api/internal/source-admin" && ["GET","POST"].includes(event.method))',
)

# Dynamic runtime source registry for the Mac pipeline. A collection batch fetches
# once; subsequent validation/recovery processes consume the local metadata cache.
source_import = re.compile(r'import\s*\{\s*intelligenceSources\s*\}\s*from\s*["\']\.\./\.\./shared/official-sources["\']\s*\n')


def insert_after_imports(value: str, declaration: str):
    if declaration in value:
        return value
    lines = value.splitlines()
    import_lines = [index for index, line in enumerate(lines) if line.startswith("import ")]
    if not import_lines:
        raise RuntimeError("no imports found")
    lines.insert(max(import_lines) + 1, declaration)
    return "\n".join(lines) + "\n"

mac_batch = root / "tools/ai-bridge/mac-batch.ts"
text = mac_batch.read_text(encoding="utf-8")
if 'fetchRuntimeIntelligenceSources' not in text:
    if not source_import.search(text):
        raise RuntimeError("mac-batch source import changed")
    text = source_import.sub('import { fetchRuntimeIntelligenceSources } from "./source-config-runtime"\n', text, count=1)
text = insert_after_imports(text, "const intelligenceSources = await fetchRuntimeIntelligenceSources()")
mac_batch.write_text(text, encoding="utf-8")

for file in (root / "tools/ai-bridge").glob("*.ts"):
    relative = file.relative_to(root).as_posix()
    if relative in {"tools/ai-bridge/mac-batch.ts", "tools/ai-bridge/source-config-runtime.ts", "tools/ai-bridge/collect-source.ts"}:
        continue
    text = file.read_text(encoding="utf-8")
    if 'readCachedRuntimeIntelligenceSources' in text:
        continue
    if not source_import.search(text):
        continue
    text = source_import.sub('import { readCachedRuntimeIntelligenceSources } from "./source-config-runtime"\n', text, count=1)
    text = insert_after_imports(text, "const intelligenceSources = readCachedRuntimeIntelligenceSources()")
    file.write_text(text, encoding="utf-8")

# Tests reflect that legacy discovery is seed-only and explicit collection never
# falls back to the institution home page.
write("test/source-config.test.ts", r'''
import { afterEach, describe, expect, it, vi } from "vitest"
import { intelligenceSources } from "../shared/official-sources"
import { sourceConfigFromIntelligenceSource, sourceConfigToIntelligenceSource, sourceConfigurationStatus } from "../shared/source-config"
import { normalizeManagedSourceConfig } from "../server/source-admin/model"
import { collectSource } from "../server/utils/intelligence-collector"

afterEach(() => vi.unstubAllGlobals())

describe("managed source configuration", () => {
  it("marks sources without fixed columns as an unconfigured legacy seed", () => {
    const source = intelligenceSources.find(item => item.id === "official-beijing")!
    const config = sourceConfigFromIntelligenceSource(source)
    expect(config.collectionMode).toBe("legacy-discovery")
    expect(sourceConfigurationStatus(config)).toBe("unconfigured")
    expect(() => normalizeManagedSourceConfig(config)).toThrow(/不能作为新的生产配置/)
  })

  it("turns published endpoints into collector columns", () => {
    const base = sourceConfigFromIntelligenceSource(intelligenceSources.find(item => item.id === "official-beijing")!)
    const config = normalizeManagedSourceConfig({
      ...base,
      collectionMode: "explicit",
      endpoints: [{ id: "notice", kind: "notice", name: "通知公告", url: `${base.home}notice/`, enabled: true }],
    })
    const source = sourceConfigToIntelligenceSource(config)
    expect(source.columns).toEqual([{ name: "通知公告", url: `${base.home}notice/` }])
    expect((source as any).collectionMode).toBe("explicit")
  })

  it("rejects private hosts, cross-host columns, duplicate columns and an empty explicit config", () => {
    const source = sourceConfigFromIntelligenceSource(intelligenceSources.find(item => item.id === "official-beijing")!)
    expect(() => normalizeManagedSourceConfig({ ...source, collectionMode: "explicit", home: "http://127.0.0.1/", endpoints: [{ id: "a", kind: "notice", name: "公告", url: "http://127.0.0.1/a", enabled: true }] })).toThrow(/IP地址/)
    expect(() => normalizeManagedSourceConfig({
      ...source,
      collectionMode: "explicit",
      endpoints: [{ id: "a", kind: "notice", name: "通知公告", url: "https://example.com/a", enabled: true }],
    })).toThrow(/同一主机/)
    expect(() => normalizeManagedSourceConfig({ ...source, collectionMode: "explicit", endpoints: [] })).toThrow(/至少需要/)
    expect(() => normalizeManagedSourceConfig({
      ...source,
      collectionMode: "explicit",
      endpoints: [
        { id: "a", kind: "notice", name: "通知公告", url: `${source.home}a`, enabled: true },
        { id: "a", kind: "policy", name: "政策文件", url: `${source.home}b`, enabled: true },
      ],
    })).toThrow(/编号重复/)
  })

  it("never falls back to the homepage in explicit mode", async () => {
    const base = sourceConfigFromIntelligenceSource(intelligenceSources.find(item => item.id === "official-beijing")!)
    const source = sourceConfigToIntelligenceSource(normalizeManagedSourceConfig({
      ...base,
      collectionMode: "explicit",
      endpoints: [{ id: "notice", kind: "notice", name: "通知公告", url: `${base.home}notice/`, enabled: true }],
    }))
    const fetchMock = vi.fn(async () => new Response("<html><body><a href='/'>首页</a></body></html>", { headers: { "content-type": "text/html" } }))
    vi.stubGlobal("fetch", fetchMock)
    await expect(collectSource(source)).rejects.toThrow(/栏目未解析到文章/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain("notice")
  })
})
''')

# Long-term rules allow an operator-only Access-protected center, while the
# visitor product remains public and has no visitor administration.
for path, needle, addition in [
    ("AGENTS.md", "- 当前不开放用户登录、授权管理后台和访客 AI 设置入口；", "- 允许使用 Cloudflare Access 保护的内部运营信息源管理中心；该入口不是访客后台，不得公开或复用为访客登录；"),
    ("docs/CHATGPT-PROJECT-INSTRUCTIONS.md", "- 不开放访客登录、授权管理后台和访客 AI 设置；", "- 可建设仅由 Cloudflare Access 保护的内部信息源管理中心，但不得变成访客后台；"),
]:
    target = root / path
    text = target.read_text(encoding="utf-8")
    if addition not in text:
        if needle not in text:
            raise RuntimeError(f"rule marker changed in {path}")
        text = text.replace(needle, needle + "\n" + addition, 1)
        target.write_text(text, encoding="utf-8")

write("docs/source-admin.md", r'''
# 信息源管理中心

内部入口：`/internal/sources`。页面按主题组织：左侧选择主题，右侧显示该主题的来源健康表；展开来源可查看具体栏目，编辑页支持发现候选栏目、逐栏/全量测试、保存草稿、发布配置和从历史版本恢复为草稿。

## 配置模型

代码中的 `shared/official-sources.ts` 仅作为初始目录和无覆盖时的种子。D1 中的已发布配置覆盖种子；发布配置后无需修改代码或重新部署。Mac worker 每轮读取当前公开主题的只读配置快照，并保存元数据缓存；读取失败时只使用上次成功缓存，不把管理草稿用于生产。

没有明确栏目配置的历史来源继续以 `legacy-discovery` 迁移状态运行，并在管理中心标为“待配置”。自动发现只用于提供候选页面，不能作为新配置发布。一旦发布明确栏目，该来源改为 `explicit`：只采集已启用栏目，不再从官网首页猜栏目，也不在栏目无结果时回退抓首页。

配置流程固定为：保存草稿 → 测试全部 → 发布。全量测试凭据只对完全相同的配置有效，24 小时过期；修改或恢复草稿后必须重新测试。单独测试某一栏目只用于诊断，不能替代全量测试。

## Cloudflare Access

该功能不是访客管理后台。生产必须在 Cloudflare Access 中同时保护：

- `/internal/sources*`
- `/api/internal/source-admin*`

Pages/Worker 环境变量：

- `SOURCE_ADMIN_ACCESS_TEAM_DOMAIN`：Access 团队域名，例如 `example.cloudflareaccess.com`；
- `SOURCE_ADMIN_ACCESS_AUD`：Access 应用 Audience；
- `SOURCE_ADMIN_ALLOWED_EMAILS`：可选，逗号分隔的额外邮箱白名单。

服务端会验证 `Cf-Access-Jwt-Assertion` 的签名、issuer 和 audience，并拒绝跨站管理写请求。缺少配置时管理 API 以 404 关闭；不得以访客登录、前端口令或可伪造的邮箱请求头代替 Access JWT。

## 安全与数据边界

- 只接受 HTTP/HTTPS 标准端口的公开域名；拒绝 localhost、IP 地址和跨主机栏目，避免管理测试成为通用代理。
- 在线测试低并发，每个栏目只读取列表和一个样本文章，返回标题、日期和附件链接等元数据；不保存页面 HTML、正文或附件字节。
- 发布采用配置总版本、来源版本、草稿内容和测试凭据多重守卫；冲突时刷新后重试。
- 历史版本只可恢复为草稿，仍需重新测试和发布。
- 信息源配置版本与文章内容 revision 分开，不通过修改配置伪造文章更新。
''')
