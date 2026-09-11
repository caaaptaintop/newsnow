import { createError, type H3Event } from "h3"
import { intelligenceSources } from "../../shared/official-sources"
import {
  intelligenceSourceConfigHash, intelligenceSourceConfigJson, intelligenceSourceSeedConfig,
  sourceConfigPolicy, validateIntelligenceSourceConfig, validateSourceDraftBase,
  type IntelligenceSourceConfig, type SourceDraftBase,
} from "../../shared/source-config"
import { sourceTestAllowsPublish } from "../source-admin/test-source-config"

interface D1Statement {
  bind: (...values: unknown[]) => D1Statement
  all: () => Promise<{ results?: Record<string, unknown>[] }>
  run: () => Promise<unknown>
}
interface D1DatabaseLike {
  prepare: (sql: string) => D1Statement
  batch: (statements: D1Statement[]) => Promise<Array<{ results?: Record<string, unknown>[] }>>
}
const schemaReady = new WeakSet<object>()
function unavailable() { return createError({ statusCode: 503, message: "来源配置读取或保存失败；已保留原配置，请稍后重试" }) }
function conflict() { return createError({ statusCode: 409, message: "草稿、测试或发布版本已变化，请刷新后重新确认" }) }
function environment(event: H3Event) {
  const context = event.context as Record<string, any>
  return context.cloudflare?.env ?? context.platform?.env ?? context.env ?? process.env
}
export function sourceConfigDatabase(event: H3Event): D1DatabaseLike {
  const db = environment(event).NEWSNOW_DB as (D1DatabaseLike & { withSession?: (mode: string) => D1DatabaseLike }) | undefined
  if (!db?.prepare || !db?.batch) throw unavailable()
  return db.withSession ? db.withSession("first-primary") : db
}
export async function ensureSourceConfigSchema(db: D1DatabaseLike) {
  if (schemaReady.has(db)) return
  // Authenticated configuration writes only. No article tables or migration markers are touched.
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS intelligence_source_config_entry (
      topic TEXT NOT NULL, source_id TEXT NOT NULL, draft_json TEXT, draft_hash TEXT,
      active_revision INTEGER, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL,
      PRIMARY KEY (topic, source_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS intelligence_source_config_revision (
      topic TEXT NOT NULL, source_id TEXT NOT NULL, revision INTEGER NOT NULL,
      config_json TEXT NOT NULL, config_hash TEXT NOT NULL, test_json TEXT,
      created_at INTEGER NOT NULL, created_by TEXT NOT NULL, reason TEXT NOT NULL,
      PRIMARY KEY (topic, source_id, revision))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS intelligence_source_config_test (
      topic TEXT NOT NULL, source_id TEXT NOT NULL, config_hash TEXT NOT NULL,
      ok INTEGER NOT NULL CHECK (ok IN (0, 1)), result_json TEXT NOT NULL,
      tested_at INTEGER NOT NULL, tested_by TEXT NOT NULL, PRIMARY KEY (topic, source_id, config_hash))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS intelligence_source_config_guard (
      id TEXT PRIMARY KEY, ok INTEGER NOT NULL CONSTRAINT source_config_state_match CHECK (ok = 1))`),
  ])
  schemaReady.add(db)
}
async function rows(statement: D1Statement) {
  const result = await statement.all()
  if (!Array.isArray(result.results)) throw unavailable()
  return result.results
}
async function first(statement: D1Statement) { return (await rows(statement))[0] ?? null }
function parseJson<T>(value: unknown): T | undefined {
  if (typeof value !== "string") return undefined
  try { return JSON.parse(value) as T }
  catch { return undefined }
}
function seed(topic: string, sourceId: string) {
  const source = intelligenceSources.find(item => item.topic === topic && item.id === sourceId)
  if (!source) throw createError({ statusCode: 404, message: "未注册的信息源" })
  return source
}
function baseGuard(db: D1DatabaseLike, id: string, topic: string, sourceId: string, base: SourceDraftBase) {
  return db.prepare(`INSERT INTO intelligence_source_config_guard VALUES (?, CASE WHEN
    (SELECT draft_hash FROM intelligence_source_config_entry WHERE topic = ? AND source_id = ?) IS ?
    AND COALESCE((SELECT active_revision FROM intelligence_source_config_entry WHERE topic = ? AND source_id = ?), 0) = ?
    THEN 1 ELSE 0 END)`).bind(id, topic, sourceId, base.draftHash, topic, sourceId, base.activeRevision)
}
async function atomic(db: D1DatabaseLike, statements: D1Statement[]) {
  try { return await db.batch(statements) }
  catch (error) {
    const text = String(error) + String((error as { cause?: unknown })?.cause ?? "")
    if (/source_config_state_match/.test(text)) throw conflict()
    throw unavailable()
  }
}
async function checkedConfig(topic: string, sourceId: string, json: unknown, expectedHash: unknown) {
  const config = validateIntelligenceSourceConfig(parseJson(json), seed(topic, sourceId))
  if (typeof expectedHash !== "string" || await intelligenceSourceConfigHash(config) !== expectedHash) throw unavailable()
  return config
}

export async function saveSourceDraft(event: H3Event, topic: string, sourceId: string, value: unknown, email: string, expected: SourceDraftBase) {
  const config = validateIntelligenceSourceConfig(value, seed(topic, sourceId))
  const base = validateSourceDraftBase(expected)
  const hash = await intelligenceSourceConfigHash(config)
  const db = sourceConfigDatabase(event)
  await ensureSourceConfigSchema(db)
  const now = Date.now(), guard = crypto.randomUUID()
  await atomic(db, [
    baseGuard(db, guard, topic, sourceId, base),
    db.prepare(`INSERT INTO intelligence_source_config_entry
      (topic, source_id, draft_json, draft_hash, active_revision, updated_at, updated_by) VALUES (?, ?, ?, ?, NULL, ?, ?)
      ON CONFLICT(topic, source_id) DO UPDATE SET draft_json = excluded.draft_json,
        draft_hash = excluded.draft_hash, updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(topic, sourceId, intelligenceSourceConfigJson(config), hash, now, email),
    db.prepare("DELETE FROM intelligence_source_config_guard WHERE id = ?").bind(guard),
  ])
  return { config, hash, activeRevision: base.activeRevision, updatedAt: now }
}
export async function saveSourceTest(event: H3Event, topic: string, sourceId: string, config: IntelligenceSourceConfig, result: unknown, email: string, expected: SourceDraftBase, startedAt: number) {
  const base = validateSourceDraftBase(expected)
  const normalized = validateIntelligenceSourceConfig(config, seed(topic, sourceId))
  const hash = await intelligenceSourceConfigHash(normalized)
  if (base.draftHash !== hash || !Number.isSafeInteger(startedAt) || startedAt < Date.now() - sourceConfigPolicy.testMaxAgeMs || startedAt > Date.now()) throw conflict()
  const db = sourceConfigDatabase(event)
  await ensureSourceConfigSchema(db)
  const json = JSON.stringify(result)
  if (new TextEncoder().encode(json).length > 96 * 1024) throw createError({ statusCode: 413, message: "测试结果过大" })
  const guard = crypto.randomUUID()
  await atomic(db, [
    baseGuard(db, guard, topic, sourceId, base),
    db.prepare(`INSERT INTO intelligence_source_config_guard VALUES (?, CASE WHEN NOT EXISTS (
      SELECT 1 FROM intelligence_source_config_test WHERE topic = ? AND source_id = ? AND config_hash = ? AND tested_at > ?
    ) THEN 1 ELSE 0 END)`).bind(`${guard}:test`, topic, sourceId, hash, startedAt),
    db.prepare(`INSERT INTO intelligence_source_config_test VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(topic, source_id, config_hash) DO UPDATE SET ok = excluded.ok, result_json = excluded.result_json,
        tested_at = excluded.tested_at, tested_by = excluded.tested_by`)
      .bind(topic, sourceId, hash, sourceTestAllowsPublish(normalized, result) ? 1 : 0, json, startedAt, email),
    db.prepare("DELETE FROM intelligence_source_config_guard WHERE id IN (?, ?)").bind(guard, `${guard}:test`),
  ])
  return { hash, testedAt: startedAt }
}
export async function publishSourceDraft(event: H3Event, topic: string, sourceId: string, expectedHash: string, email: string, expectedRevision: number, expectedTestedAt: number) {
  const base = validateSourceDraftBase({ draftHash: expectedHash, activeRevision: expectedRevision })
  const db = sourceConfigDatabase(event)
  await ensureSourceConfigSchema(db)
  const entrySql = "SELECT * FROM intelligence_source_config_entry WHERE topic = ? AND source_id = ?"
  const repeated = async () => {
    const row = await first(db.prepare(`SELECT entry.draft_hash, entry.active_revision, r.config_hash, r.created_at
      FROM intelligence_source_config_entry entry JOIN intelligence_source_config_revision r
      ON r.topic = entry.topic AND r.source_id = entry.source_id AND r.revision = entry.active_revision
      WHERE entry.topic = ? AND entry.source_id = ?`).bind(topic, sourceId))
    if (row?.draft_hash === expectedHash && row.config_hash === expectedHash
      && [expectedRevision, expectedRevision + 1].includes(Number(row.active_revision))) {
      return { revision: Number(row.active_revision), publishedAt: Number(row.created_at), repeated: true }
    }
  }
  const prior = await repeated()
  if (prior) return prior
  const entry = await first(db.prepare(entrySql).bind(topic, sourceId))
  if (!entry?.draft_json || entry.draft_hash !== expectedHash || Number(entry.active_revision ?? 0) !== expectedRevision) throw conflict()
  const config = await checkedConfig(topic, sourceId, entry.draft_json, expectedHash)
  const test = await first(db.prepare("SELECT * FROM intelligence_source_config_test WHERE topic = ? AND source_id = ? AND config_hash = ?").bind(topic, sourceId, expectedHash))
  const now = Date.now()
  if (!test || Number(test.ok) !== 1 || !Number.isSafeInteger(expectedTestedAt) || Number(test.tested_at) !== expectedTestedAt
    || expectedTestedAt > now || expectedTestedAt < now - sourceConfigPolicy.testMaxAgeMs
    || !sourceTestAllowsPublish(config, parseJson(test.result_json))) throw createError({ statusCode: 409, message: "需要一小时内、与当前草稿完全匹配且可发布的测试" })
  const next = expectedRevision + 1, guard = crypto.randomUUID()
  try {
    await atomic(db, [
      baseGuard(db, guard, topic, sourceId, base),
      db.prepare(`INSERT INTO intelligence_source_config_guard VALUES (?, CASE WHEN
        EXISTS (SELECT 1 FROM intelligence_source_config_test WHERE topic = ? AND source_id = ? AND config_hash = ?
          AND ok = 1 AND tested_at = ? AND result_json = ?)
        AND COALESCE((SELECT MAX(revision) FROM intelligence_source_config_revision WHERE topic = ? AND source_id = ?), 0) = ?
        AND (SELECT draft_json FROM intelligence_source_config_entry WHERE topic = ? AND source_id = ?) = ?
        THEN 1 ELSE 0 END)`).bind(`${guard}:test`, topic, sourceId, expectedHash, expectedTestedAt, test.result_json,
        topic, sourceId, expectedRevision, topic, sourceId, entry.draft_json),
      db.prepare(`INSERT INTO intelligence_source_config_revision VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'publish')`)
        .bind(topic, sourceId, next, entry.draft_json, expectedHash, test.result_json, now, email),
      db.prepare(`UPDATE intelligence_source_config_entry SET active_revision = ?, updated_at = ?, updated_by = ?
        WHERE topic = ? AND source_id = ?`).bind(next, now, email, topic, sourceId),
      db.prepare(`INSERT INTO intelligence_source_config_guard VALUES (?, CASE WHEN changes() = 1 THEN 1 ELSE 0 END)`).bind(`${guard}:after`),
      db.prepare("DELETE FROM intelligence_source_config_guard WHERE id IN (?, ?, ?)").bind(guard, `${guard}:test`, `${guard}:after`),
    ])
  }
  catch (error) {
    // A lost success response or a concurrent identical request may reuse the exact committed result.
    const done = await repeated()
    if (done) return done
    throw error
  }
  return { revision: next, publishedAt: now, repeated: false }
}
/** Restoring history never publishes it and cannot overwrite a concurrent edit. */
export async function rollbackSourceConfig(event: H3Event, topic: string, sourceId: string, targetRevision: number, email: string, base: SourceDraftBase) {
  const db = sourceConfigDatabase(event)
  await ensureSourceConfigSchema(db)
  const target = await first(db.prepare("SELECT * FROM intelligence_source_config_revision WHERE topic = ? AND source_id = ? AND revision = ?").bind(topic, sourceId, targetRevision))
  if (!target) throw createError({ statusCode: 404, message: "历史版本不存在" })
  const config = await checkedConfig(topic, sourceId, target.config_json, target.config_hash)
  return { ...await saveSourceDraft(event, topic, sourceId, config, email, base), restoredFrom: targetRevision }
}
async function sourceHealth(db: D1DatabaseLike, topic: string) {
  const records = new Map<string, Record<string, unknown>>()
  if (topic !== "building") return { records, error: undefined }
  try {
    // publishBatch stores normalized source status as JSON in the existing v3 table.
    const result = await rows(db.prepare("SELECT id, data, checked_at FROM building_sources_v3"))
    for (const row of result) {
      const data = parseJson<Record<string, unknown>>(row.data)
      const valid = data && typeof data === "object" && !Array.isArray(data)
        && ["ok", "partial", "error"].includes(String(data.status))
      records.set(String(row.id), valid
        ? { ...data, checkedAt: row.checked_at }
        : { status: "unknown", message: "来源运行记录损坏或状态无效" })
    }
    return { records, error: undefined }
  }
  catch {
    // Keep configuration repair available, but do not disguise a read failure as no history.
    return { records, error: "来源运行记录读取失败；不能据此判断采集健康" }
  }
}

function runtimeStatus(row: Record<string, unknown> | undefined, readError?: string) {
  if (!row) return { status: "unknown", message: readError ?? "尚无运行记录" }
  const status = String(row.status ?? "unknown")
  const checkedAt = Number(row.checkedAt)
  return {
    status,
    message: String(row.message ?? row.error ?? (["partial", "error"].includes(status)
      ? "本次发布记录未包含失败详情，需核对采集日志" : "")),
    updatedAt: Number.isFinite(checkedAt) && checkedAt > 0 ? checkedAt : undefined,
    candidateCount: Number(row.fetched ?? 0) || 0,
    acceptedCount: Number(row.accepted ?? 0) || 0,
  }
}


async function configTablesExist(db: D1DatabaseLike) {
  const tables = await rows(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name IN ('intelligence_source_config_entry', 'intelligence_source_config_revision')`))
  if (!tables.length) return false
  const names = new Set(tables.map(row => row.name))
  if (!names.has("intelligence_source_config_entry") || !names.has("intelligence_source_config_revision")) throw unavailable()
  return true
}
export async function sourceAdminModel(event: H3Event, topic: string) {
  const db = sourceConfigDatabase(event)
  const exists = await configTablesExist(db)
  // A first GET is read-only, including the initial empty database case.
  const entries = exists ? await rows(db.prepare("SELECT * FROM intelligence_source_config_entry WHERE topic = ?").bind(topic)) : []
  const revisions = exists ? await rows(db.prepare(`SELECT source_id, revision, config_json, config_hash, created_at, created_by, reason FROM (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY source_id ORDER BY revision DESC) AS n
    FROM intelligence_source_config_revision WHERE topic = ?) WHERE n <= 20`).bind(topic)) : []
  const tests = exists ? await rows(db.prepare(`SELECT t.* FROM intelligence_source_config_test t
    JOIN intelligence_source_config_entry e ON t.topic = e.topic AND t.source_id = e.source_id AND t.config_hash = e.draft_hash
    WHERE t.topic = ?`).bind(topic)) : []
  const health = await sourceHealth(db, topic)
  const sources = await Promise.all(intelligenceSources.filter(source => source.topic === topic).map(async (source) => {
    const entry = entries.find(row => row.source_id === source.id)
    const activeRevision = Number(entry?.active_revision ?? 0)
    const history = revisions.filter(row => row.source_id === source.id)
    const active = history.find(row => Number(row.revision) === activeRevision)
    if (activeRevision && !active) throw unavailable()
    const effective = active ? await checkedConfig(topic, source.id, active.config_json, active.config_hash) : intelligenceSourceSeedConfig(source)
    const draft = entry?.draft_json ? await checkedConfig(topic, source.id, entry.draft_json, entry.draft_hash) : undefined
    const test = tests.find(row => row.source_id === source.id)
    return { id: source.id, topic, effective, draft, draftHash: entry?.draft_hash ?? null, activeRevision,
      configStatus: draft && entry?.draft_hash !== active?.config_hash ? "draft" : active ? "published" : effective.collectionMode === "discover" ? "unconfigured" : "seed",
      runtime: runtimeStatus(health.records.get(source.id), health.error),
      lastTest: test ? { hash: test.config_hash, testedAt: test.tested_at, result: parseJson(test.result_json) } : undefined,
      history: history.map(row => ({ revision: Number(row.revision), createdAt: Number(row.created_at), createdBy: String(row.created_by), reason: String(row.reason) })) }
  }))
  const labels: Record<string, string> = { building: "建筑", ai: "AI", finance: "财经", health: "健康" }
  const topics = Object.entries(labels).map(([id, name]) => ({ id, name, count: intelligenceSources.filter(source => source.topic === id).length, enabled: id === "building" }))
  return { topics, topic, sources, healthError: health.error }
}
export async function publishedBuildingSourceOverrides(event: H3Event) {
  const db = sourceConfigDatabase(event)
  try {
    if (!await configTablesExist(db)) return [] as IntelligenceSourceConfig[]
    const result = await rows(db.prepare(`SELECT entry.source_id, revision.config_json, revision.config_hash
      FROM intelligence_source_config_entry entry LEFT JOIN intelligence_source_config_revision revision
      ON revision.topic = entry.topic AND revision.source_id = entry.source_id AND revision.revision = entry.active_revision
      WHERE entry.topic = 'building' AND entry.active_revision IS NOT NULL ORDER BY entry.source_id`))
    return await Promise.all(result.map(row => checkedConfig("building", String(row.source_id), row.config_json, row.config_hash)))
  }
  catch { throw unavailable() }
}
