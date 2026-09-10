import { createError, type H3Event } from "h3"
import { intelligenceSources } from "../../shared/official-sources"
import {
  intelligenceSourceConfigHash,
  intelligenceSourceConfigJson,
  intelligenceSourceSeedConfig,
  validateIntelligenceSourceConfig,
  type IntelligenceSourceConfig,
} from "../../shared/source-config"

interface D1Statement {
  bind: (...values: unknown[]) => D1Statement
  all: () => Promise<{ results?: Record<string, unknown>[] }>
  first?: <T = Record<string, unknown>>() => Promise<T | null>
  run: () => Promise<{ meta?: { changes?: number } }>
}

interface D1DatabaseLike {
  prepare: (sql: string) => D1Statement
  batch: (statements: D1Statement[]) => Promise<Array<{ results?: Record<string, unknown>[], meta?: { changes?: number } }>>
}

const schemaReady = new WeakSet<object>()

function environment(event: H3Event) {
  const context = event.context as Record<string, any>
  return context.cloudflare?.env ?? context.platform?.env ?? context.env ?? process.env
}

export function sourceConfigDatabase(event: H3Event, required = true): D1DatabaseLike | undefined {
  const db = environment(event).NEWSNOW_DB as D1DatabaseLike | undefined
  if (!db?.prepare || !db?.batch) {
    if (required) throw createError({ statusCode: 503, statusMessage: "Source configuration database unavailable" })
    return undefined
  }
  return db
}

export async function ensureSourceConfigSchema(db: D1DatabaseLike) {
  if (schemaReady.has(db as object)) return
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS intelligence_source_config_entry (
      topic TEXT NOT NULL,
      source_id TEXT NOT NULL,
      draft_json TEXT,
      draft_hash TEXT,
      active_revision INTEGER,
      updated_at INTEGER NOT NULL,
      updated_by TEXT NOT NULL,
      PRIMARY KEY (topic, source_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS intelligence_source_config_revision (
      topic TEXT NOT NULL,
      source_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      config_json TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      test_json TEXT,
      created_at INTEGER NOT NULL,
      created_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      PRIMARY KEY (topic, source_id, revision)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS intelligence_source_config_test (
      topic TEXT NOT NULL,
      source_id TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
      result_json TEXT NOT NULL,
      tested_at INTEGER NOT NULL,
      tested_by TEXT NOT NULL,
      PRIMARY KEY (topic, source_id, config_hash)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS intelligence_source_revision_active ON intelligence_source_config_revision(topic, source_id, revision)"),
  ])
  schemaReady.add(db as object)
}

async function rows(statement: D1Statement) {
  return (await statement.all()).results ?? []
}

async function first(statement: D1Statement) {
  if (statement.first) return await statement.first<Record<string, unknown>>()
  return (await rows(statement))[0] ?? null
}

function parseJson<T>(value: unknown): T | undefined {
  if (typeof value !== "string") return undefined
  try {
    return JSON.parse(value) as T
  }
  catch {
    return undefined
  }
}

function seed(topic: string, sourceId: string) {
  const source = intelligenceSources.find(item => item.topic === topic && item.id === sourceId)
  if (!source) throw createError({ statusCode: 404, statusMessage: "Unknown source" })
  return source
}

export async function saveSourceDraft(event: H3Event, topic: string, sourceId: string, value: unknown, email: string) {
  const db = sourceConfigDatabase(event)!
  await ensureSourceConfigSchema(db)
  const config = validateIntelligenceSourceConfig(value, seed(topic, sourceId))
  const hash = await intelligenceSourceConfigHash(config)
  const now = Date.now()
  await db.prepare(`INSERT INTO intelligence_source_config_entry
    (topic, source_id, draft_json, draft_hash, active_revision, updated_at, updated_by)
    VALUES (?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(topic, source_id) DO UPDATE SET
      draft_json = excluded.draft_json,
      draft_hash = excluded.draft_hash,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by`).bind(topic, sourceId, intelligenceSourceConfigJson(config), hash, now, email).run()
  return { config, hash, updatedAt: now }
}

export async function saveSourceTest(event: H3Event, topic: string, sourceId: string, config: IntelligenceSourceConfig, result: unknown, ok: boolean, email: string) {
  const db = sourceConfigDatabase(event)!
  await ensureSourceConfigSchema(db)
  const hash = await intelligenceSourceConfigHash(config)
  const now = Date.now()
  await db.prepare(`INSERT INTO intelligence_source_config_test
    (topic, source_id, config_hash, ok, result_json, tested_at, tested_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(topic, source_id, config_hash) DO UPDATE SET
      ok = excluded.ok,
      result_json = excluded.result_json,
      tested_at = excluded.tested_at,
      tested_by = excluded.tested_by`).bind(topic, sourceId, hash, ok ? 1 : 0, JSON.stringify(result), now, email).run()
  return { hash, testedAt: now }
}

export async function publishSourceDraft(event: H3Event, topic: string, sourceId: string, expectedHash: string, email: string) {
  const db = sourceConfigDatabase(event)!
  await ensureSourceConfigSchema(db)
  const entry = await first(db.prepare("SELECT * FROM intelligence_source_config_entry WHERE topic = ? AND source_id = ?").bind(topic, sourceId))
  if (!entry?.draft_json || entry.draft_hash !== expectedHash) throw createError({ statusCode: 409, statusMessage: "Draft changed; test the current draft again" })
  const test = await first(db.prepare("SELECT * FROM intelligence_source_config_test WHERE topic = ? AND source_id = ? AND config_hash = ?").bind(topic, sourceId, expectedHash))
  if (!test || Number(test.ok) !== 1) throw createError({ statusCode: 409, statusMessage: "A successful test for the current draft is required" })
  const current = await first(db.prepare("SELECT COALESCE(MAX(revision), 0) AS revision FROM intelligence_source_config_revision WHERE topic = ? AND source_id = ?").bind(topic, sourceId))
  const next = Number(current?.revision ?? 0) + 1
  const now = Date.now()
  const results = await db.batch([
    db.prepare(`INSERT INTO intelligence_source_config_revision
      (topic, source_id, revision, config_json, config_hash, test_json, created_at, created_by, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'publish')`).bind(topic, sourceId, next, entry.draft_json, expectedHash, test.result_json ?? null, now, email),
    db.prepare(`UPDATE intelligence_source_config_entry SET active_revision = ?, updated_at = ?, updated_by = ?
      WHERE topic = ? AND source_id = ? AND draft_hash = ?`).bind(next, now, email, topic, sourceId, expectedHash),
  ])
  if (Number(results[1]?.meta?.changes ?? 0) !== 1) throw createError({ statusCode: 409, statusMessage: "Draft changed during publish" })
  return { revision: next, publishedAt: now }
}

export async function rollbackSourceConfig(event: H3Event, topic: string, sourceId: string, targetRevision: number, email: string) {
  const db = sourceConfigDatabase(event)!
  await ensureSourceConfigSchema(db)
  const target = await first(db.prepare("SELECT * FROM intelligence_source_config_revision WHERE topic = ? AND source_id = ? AND revision = ?").bind(topic, sourceId, targetRevision))
  if (!target?.config_json || !target.config_hash) throw createError({ statusCode: 404, statusMessage: "Revision not found" })
  const current = await first(db.prepare("SELECT COALESCE(MAX(revision), 0) AS revision FROM intelligence_source_config_revision WHERE topic = ? AND source_id = ?").bind(topic, sourceId))
  const next = Number(current?.revision ?? 0) + 1
  const now = Date.now()
  await db.batch([
    db.prepare(`INSERT INTO intelligence_source_config_revision
      (topic, source_id, revision, config_json, config_hash, test_json, created_at, created_by, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(topic, sourceId, next, target.config_json, target.config_hash, target.test_json ?? null, now, email, `rollback:${targetRevision}`),
    db.prepare(`INSERT INTO intelligence_source_config_entry
      (topic, source_id, draft_json, draft_hash, active_revision, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(topic, source_id) DO UPDATE SET
        draft_json = excluded.draft_json,
        draft_hash = excluded.draft_hash,
        active_revision = excluded.active_revision,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by`).bind(topic, sourceId, target.config_json, target.config_hash, next, now, email),
  ])
  return { revision: next, rolledBackFrom: targetRevision, publishedAt: now }
}

async function sourceHealth(db: D1DatabaseLike, topic: string) {
  if (topic !== "building") return new Map<string, Record<string, unknown>>()
  try {
    const result = await rows(db.prepare("SELECT * FROM building_source_states"))
    return new Map(result.map(row => [String(row.source_id ?? row.sourceId ?? row.id ?? ""), row]))
  }
  catch {
    return new Map<string, Record<string, unknown>>()
  }
}

function runtimeStatus(row: Record<string, unknown> | undefined) {
  if (!row) return { status: "unknown", message: "尚无运行记录" }
  return {
    status: String(row.status ?? row.state ?? "unknown"),
    message: String(row.message ?? row.error ?? row.warning ?? ""),
    updatedAt: Number(row.updated_at ?? row.updatedAt ?? row.checked_at ?? row.checkedAt ?? row.last_checked_at ?? 0) || undefined,
    candidateCount: Number(row.candidate_count ?? row.candidateCount ?? 0) || 0,
    acceptedCount: Number(row.accepted_count ?? row.acceptedCount ?? 0) || 0,
  }
}

export async function sourceAdminModel(event: H3Event, topic: string) {
  const db = sourceConfigDatabase(event)!
  await ensureSourceConfigSchema(db)
  const entries = await rows(db.prepare("SELECT * FROM intelligence_source_config_entry WHERE topic = ?").bind(topic))
  const revisions = await rows(db.prepare("SELECT topic, source_id, revision, config_json, config_hash, created_at, created_by, reason FROM intelligence_source_config_revision WHERE topic = ? ORDER BY source_id, revision DESC").bind(topic))
  const entryById = new Map(entries.map(row => [String(row.source_id), row]))
  const revisionByKey = new Map(revisions.map(row => [`${row.source_id}:${row.revision}`, row]))
  const historyById = new Map<string, Record<string, unknown>[]>()
  for (const row of revisions) {
    const id = String(row.source_id)
    const list = historyById.get(id) ?? []
    if (list.length < 20) list.push({
      revision: Number(row.revision),
      createdAt: Number(row.created_at),
      createdBy: String(row.created_by),
      reason: String(row.reason),
    })
    historyById.set(id, list)
  }
  const health = await sourceHealth(db, topic)
  const sources = intelligenceSources.filter(source => source.topic === topic).map((source) => {
    const entry = entryById.get(source.id)
    const activeRevision = Number(entry?.active_revision ?? 0) || 0
    const activeRow = revisionByKey.get(`${source.id}:${activeRevision}`)
    const activeConfig = parseJson<IntelligenceSourceConfig>(activeRow?.config_json)
    const draftConfig = parseJson<IntelligenceSourceConfig>(entry?.draft_json)
    const effective = activeConfig ?? intelligenceSourceSeedConfig(source)
    const configStatus = draftConfig && entry?.draft_hash !== activeRow?.config_hash
      ? "draft"
      : activeConfig
        ? "published"
        : effective.collectionMode === "discover"
          ? "unconfigured"
          : "seed"
    return {
      id: source.id,
      topic: source.topic,
      effective,
      draft: draftConfig,
      draftHash: entry?.draft_hash,
      activeRevision,
      configStatus,
      runtime: runtimeStatus(health.get(source.id)),
      history: historyById.get(source.id) ?? [],
    }
  })
  const topicOrder = ["building", "ai", "finance", "health"]
  const labels: Record<string, string> = { building: "建筑", ai: "AI", finance: "财经", health: "健康" }
  const topics = topicOrder.map(id => ({
    id,
    name: labels[id],
    count: intelligenceSources.filter(source => source.topic === id).length,
    enabled: id === "building",
  }))
  return { topics, topic, sources }
}

export async function publishedBuildingSourceOverrides(event: H3Event) {
  const db = sourceConfigDatabase(event, false)
  if (!db) return [] as IntelligenceSourceConfig[]
  try {
    const result = await rows(db.prepare(`SELECT revision.config_json
      FROM intelligence_source_config_entry entry
      JOIN intelligence_source_config_revision revision
        ON revision.topic = entry.topic AND revision.source_id = entry.source_id AND revision.revision = entry.active_revision
      WHERE entry.topic = 'building' AND entry.active_revision IS NOT NULL`))
    return result
      .map(row => parseJson<IntelligenceSourceConfig>(row.config_json))
      .filter((value): value is IntelligenceSourceConfig => Boolean(value))
  }
  catch {
    return []
  }
}
