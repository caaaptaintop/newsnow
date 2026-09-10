import type { IntelligenceTopic } from "../../shared/intelligence"
import { intelligenceSources } from "../../shared/official-sources"
import { sourceConfigFromIntelligenceSource, sourceConfigurationStatus, type ManagedSourceConfig, type SourceConfigSnapshot } from "../../shared/source-config"
import { BuildingError } from "../../shared/building-contract"
import type { BuildingDB } from "../building/store"
import { normalizeManagedSourceConfig, parseStoredConfig } from "./model"

const topicNames: Record<string, string> = { building: "建筑", ai: "AI", finance: "财经", health: "健康" }
const topicOrder = ["building", "ai", "finance", "health"]

interface PublishedRow { source_id: string, topic: string, version: number, data: string, updated_at: number, updated_by: string }
interface DraftRow { source_id: string, topic: string, base_version: number, data: string, updated_at: number, updated_by: string, note: string }

function seeds() {
  return intelligenceSources.map(sourceConfigFromIntelligenceSource)
}

async function configMeta(db: BuildingDB) {
  const row = await db.prepare("SELECT revision,updated_at FROM source_config_meta_v1 WHERE id=1").first<{ revision: number, updated_at: number }>()
  if (!row) throw new BuildingError(503, "信息源配置库尚未初始化")
  return row
}

async function publishedRows(db: BuildingDB, topic?: string) {
  const result = topic
    ? await db.prepare("SELECT * FROM source_config_published_v1 WHERE topic=? ORDER BY source_id").bind(topic).all<PublishedRow>()
    : await db.prepare("SELECT * FROM source_config_published_v1 ORDER BY topic,source_id").all<PublishedRow>()
  return result.results
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
    generatedAt: Date.now(),
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
  const drafts = (await db.prepare("SELECT * FROM source_config_drafts_v1 ORDER BY topic,source_id").all<DraftRow>()).results
  const draftMap = new Map(drafts.map(row => [row.source_id, row]))
  const healthRows = (await db.prepare("SELECT * FROM source_health_rollup_v1").all<any>()).results
  const healthMap = new Map(healthRows.map(row => [row.source_id, row]))
  const legacyRows = (await db.prepare("SELECT id,data,checked_at FROM building_sources_v3").all<any>()).results
  const legacyMap = new Map(legacyRows.map(row => [row.id, row]))
  const map = new Map(seeds().map(source => [source.id, source]))
  for (const row of published) {
    const config = parseStoredConfig(row.data)
    if (config) map.set(config.id, config)
  }
  const sources = [...map.values()].map(config => {
    const publishedRow = publishedMap.get(config.id)
    const draftRow = draftMap.get(config.id)
    const rollup: any = healthMap.get(config.id)
    const legacy: any = legacyMap.get(config.id)
    let state: any
    try { state = rollup ? JSON.parse(rollup.data) : legacy ? JSON.parse(legacy.data) : undefined } catch { state = undefined }
    const status = rollup?.status ?? state?.status ?? "unknown"
    const checkedAt = rollup?.checked_at ?? legacy?.checked_at ?? state?.checkedAt ?? null
    return {
      config,
      publishedVersion: publishedRow?.version ?? 0,
      publishedAt: publishedRow?.updated_at ?? null,
      hasDraft: Boolean(draftRow),
      draftUpdatedAt: draftRow?.updated_at ?? null,
      configurationStatus: draftRow ? "draft" : sourceConfigurationStatus(config),
      health: {
        status,
        checkedAt,
        lastSuccessAt: rollup?.last_success_at ?? (status !== "error" ? checkedAt : null),
        lastErrorAt: rollup?.last_error_at ?? (status === "error" ? checkedAt : null),
        consecutiveFailures: rollup?.consecutive_failures ?? (status === "error" ? 1 : 0),
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
  const history = (await db.prepare("SELECT source_id,version,topic,data,published_at,published_by,note FROM source_config_history_v1 WHERE source_id=? ORDER BY version DESC LIMIT 20").bind(sourceId).all<any>()).results.map(row => ({
    version: row.version,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    note: row.note,
    config: parseStoredConfig(row.data),
  }))
  return {
    ...source,
    draft: draftRow ? {
      baseVersion: draftRow.base_version,
      updatedAt: draftRow.updated_at,
      updatedBy: draftRow.updated_by,
      note: draftRow.note,
      config: parseStoredConfig(draftRow.data),
    } : null,
    history,
  }
}

export async function saveSourceDraft(db: BuildingDB, actor: string, body: any) {
  const config = normalizeManagedSourceConfig(body?.config)
  const current = await db.prepare("SELECT version FROM source_config_published_v1 WHERE source_id=?").bind(config.id).first<{ version: number }>()
  const currentVersion = current?.version ?? 0
  if (!Number.isSafeInteger(body?.baseVersion) || body.baseVersion !== currentVersion) throw new BuildingError(409, "信息源配置基线已变化，请刷新后重试")
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : ""
  const now = Date.now()
  await db.prepare(`INSERT INTO source_config_drafts_v1(source_id,topic,base_version,data,updated_at,updated_by,note)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_id) DO UPDATE SET topic=excluded.topic,base_version=excluded.base_version,
    data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by,note=excluded.note`).bind(config.id, config.topic, currentVersion, JSON.stringify(config), now, actor, note).run()
  return { saved: true, sourceId: config.id, baseVersion: currentVersion, updatedAt: now }
}

export async function publishSourceDraft(db: BuildingDB, actor: string, body: any) {
  const sourceId = typeof body?.sourceId === "string" ? body.sourceId : ""
  const draft = await db.prepare("SELECT * FROM source_config_drafts_v1 WHERE source_id=?").bind(sourceId).first<DraftRow>()
  if (!draft) throw new BuildingError(404, "没有可发布的草稿")
  const config = parseStoredConfig(draft.data)
  if (!config) throw new BuildingError(409, "草稿内容无效")
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
      db.prepare(`INSERT INTO building_guards_v3 VALUES(?,CASE WHEN
        (SELECT revision FROM source_config_meta_v1 WHERE id=1)=? AND
        COALESCE((SELECT version FROM source_config_published_v1 WHERE source_id=?),0)=? AND
        EXISTS(SELECT 1 FROM source_config_drafts_v1 WHERE source_id=? AND base_version=?)
        THEN 1 ELSE 0 END)`).bind(guard, meta.revision, sourceId, currentVersion, sourceId, currentVersion),
      db.prepare("INSERT INTO source_config_history_v1(source_id,version,topic,data,published_at,published_by,note) VALUES(?,?,?,?,?,?,?)").bind(sourceId, version, config.topic, JSON.stringify(config), now, actor, draft.note),
      db.prepare(`INSERT INTO source_config_published_v1(source_id,topic,version,data,updated_at,updated_by) VALUES(?,?,?,?,?,?)
        ON CONFLICT(source_id) DO UPDATE SET topic=excluded.topic,version=excluded.version,data=excluded.data,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(sourceId, config.topic, version, JSON.stringify(config), now, actor),
      db.prepare("DELETE FROM source_config_drafts_v1 WHERE source_id=?").bind(sourceId),
      db.prepare("UPDATE source_config_meta_v1 SET revision=?,updated_at=? WHERE id=1").bind(meta.revision + 1, now),
      db.prepare("DELETE FROM building_guards_v3 WHERE id=?").bind(guard),
    ])
  } catch (error) {
    throw new BuildingError(409, `信息源配置发布冲突：${String(error)}`)
  }
  return { published: true, sourceId, version, revision: meta.revision + 1, publishedAt: now }
}

export async function restoreSourceHistory(db: BuildingDB, actor: string, body: any) {
  const sourceId = typeof body?.sourceId === "string" ? body.sourceId : ""
  const version = Number(body?.version)
  if (!Number.isSafeInteger(version) || version < 1) throw new BuildingError(400, "历史版本无效")
  const row = await db.prepare("SELECT data FROM source_config_history_v1 WHERE source_id=? AND version=?").bind(sourceId, version).first<{ data: string }>()
  const config = row ? parseStoredConfig(row.data) : undefined
  if (!config) throw new BuildingError(404, "历史版本不存在")
  const current = await db.prepare("SELECT version FROM source_config_published_v1 WHERE source_id=?").bind(sourceId).first<{ version: number }>()
  return saveSourceDraft(db, actor, { config, baseVersion: current?.version ?? 0, note: `恢复自版本 ${version}` })
}
