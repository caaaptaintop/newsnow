import { createError, type H3Event } from "h3"
import { intelligenceSources } from "../../shared/official-sources"
import { intelligenceSourceConfigHash, sourceConfigPolicy, validateIntelligenceSourceConfig, type IntelligenceSourceConfig } from "../../shared/source-config"
import { sourceConfigDatabase, saveSourceTest } from "../utils/source-config-store"
import { sourceTestAllowsPublish } from "./test-source-config"

function conflict() { return createError({ statusCode: 409, message: "草稿、测试或发布版本已变化，请刷新后重新确认" }) }
function unavailable() { return createError({ statusCode: 503, message: "来源配置读取或保存失败；已保留原配置，请稍后重试" }) }
async function rows(statement: any) {
  const result = await statement.all()
  if (!Array.isArray(result.results)) throw unavailable()
  return result.results as Record<string, unknown>[]
}
async function first(statement: any) { return (await rows(statement))[0] ?? null }
function parseJson<T>(value: unknown): T | undefined {
  if (typeof value !== "string") return undefined
  try { return JSON.parse(value) as T } catch { return undefined }
}
function seed(topic: string, sourceId: string) {
  const source = intelligenceSources.find(item => item.topic === topic && item.id === sourceId)
  if (!source) throw createError({ statusCode: 404, message: "未注册的信息源" })
  return source
}
async function checkedConfig(topic: string, sourceId: string, json: unknown, expectedHash: unknown) {
  const config = validateIntelligenceSourceConfig(parseJson(json), seed(topic, sourceId))
  if (typeof expectedHash !== "string" || await intelligenceSourceConfigHash(config) !== expectedHash) throw unavailable()
  return config
}
async function configTablesExist(db: any) {
  const tables = await rows(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name IN ('intelligence_source_config_entry', 'intelligence_source_config_revision', 'intelligence_source_config_test')`))
  if (!tables.length) return false
  const names = new Set(tables.map(row => row.name))
  if (!["intelligence_source_config_entry", "intelligence_source_config_revision", "intelligence_source_config_test"].every(name => names.has(name))) throw unavailable()
  return true
}

export async function pendingRuntimeSourceTests(event: H3Event, limit = 1) {
  const db = sourceConfigDatabase(event)
  if (!await configTablesExist(db)) return { jobs: [] as Array<{ topic: string, sourceId: string, config: IntelligenceSourceConfig, hash: string, activeRevision: number, requestedAt: number }> }
  const safeLimit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(4, limit)) : 1
  const candidates = await rows(db.prepare(`SELECT e.topic, e.source_id, e.draft_json, e.draft_hash, e.active_revision,
      t.result_json, t.tested_at
    FROM intelligence_source_config_entry e JOIN intelligence_source_config_test t
      ON t.topic = e.topic AND t.source_id = e.source_id AND t.config_hash = e.draft_hash
    WHERE e.topic = 'building' AND t.ok = 0 AND t.tested_at >= ? ORDER BY t.tested_at LIMIT 24`).bind(Date.now() - sourceConfigPolicy.testMaxAgeMs))
  const jobs: Array<{ topic: string, sourceId: string, config: IntelligenceSourceConfig, hash: string, activeRevision: number, requestedAt: number }> = []
  for (const row of candidates) {
    const result = parseJson<{ runtimePending?: unknown }>(row.result_json)
    if (result?.runtimePending !== true || typeof row.draft_hash !== "string") continue
    const topic = String(row.topic), sourceId = String(row.source_id)
    const config = await checkedConfig(topic, sourceId, row.draft_json, row.draft_hash)
    jobs.push({ topic, sourceId, config, hash: row.draft_hash, activeRevision: Number(row.active_revision ?? 0), requestedAt: Number(row.tested_at) })
    if (jobs.length >= safeLimit) break
  }
  return { jobs }
}

export async function saveRuntimeSourceTest(event: H3Event, owner: string, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw createError({ statusCode: 400, message: "本机测试结果无效" })
  const body = value as Record<string, unknown>
  const topic = String(body.topic ?? ""), sourceId = String(body.sourceId ?? ""), hash = body.hash
  const activeRevision = Number(body.activeRevision), requestedAt = Number(body.requestedAt), startedAt = Number(body.startedAt)
  if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash) || !Number.isSafeInteger(activeRevision) || activeRevision < 0
    || !Number.isSafeInteger(requestedAt) || requestedAt <= 0 || !Number.isSafeInteger(startedAt) || startedAt <= 0) throw createError({ statusCode: 400, message: "本机测试版本信息无效" })
  if (!body.result || typeof body.result !== "object" || Array.isArray(body.result)) throw createError({ statusCode: 400, message: "本机测试结果格式无效" })
  const db = sourceConfigDatabase(event)
  if (!await configTablesExist(db)) throw conflict()
  const entry = await first(db.prepare("SELECT draft_json, draft_hash, active_revision FROM intelligence_source_config_entry WHERE topic = ? AND source_id = ?").bind(topic, sourceId))
  if (!entry?.draft_json || entry.draft_hash !== hash || Number(entry.active_revision ?? 0) !== activeRevision) throw conflict()
  const pending = await first(db.prepare("SELECT ok, result_json, tested_at FROM intelligence_source_config_test WHERE topic = ? AND source_id = ? AND config_hash = ?").bind(topic, sourceId, hash))
  const pendingResult = parseJson<{ runtimePending?: unknown }>(pending?.result_json)
  if (!pending || Number(pending.ok) !== 0 || Number(pending.tested_at) !== requestedAt || pendingResult?.runtimePending !== true
    || requestedAt < Date.now() - sourceConfigPolicy.testMaxAgeMs) throw conflict()
  const config = await checkedConfig(topic, sourceId, entry.draft_json, hash)
  const result = { ...(body.result as Record<string, unknown>), executor: "mac", runtimePending: false }
  const saved = await saveSourceTest(event, topic, sourceId, config, result, owner, { draftHash: hash, activeRevision }, startedAt)
  return { ...saved, publishable: sourceTestAllowsPublish(config, result) }
}
