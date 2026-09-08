import type { Database } from "db0"
import type { IntelligenceArticle, IntelligenceTopic } from "@shared/intelligence"
import { intelligenceMetadataOnly, intelligenceStoragePolicy } from "@shared/intelligence-storage"
import { intelligenceBackfillV2, intelligenceReadV2, intelligenceSaveV2, intelligenceSchemaV2 } from "../database/intelligence-v2"

const temporary = new Map<string, unknown>()
const initialization = new WeakMap<object, Promise<void>>()
function unpackRows(result: any): any[] { return Array.isArray(result) ? result : result?.results ?? [] }
function memorySet(key: string, value: unknown) {
  temporary.set(key, value)
  while (temporary.size > 3000) temporary.delete(temporary.keys().next().value!)
}
async function initialize(db: Database) {
  let pending = initialization.get(db)
  if (!pending) {
    pending = (async () => {
      for (const statement of intelligenceSchemaV2) await db.prepare(statement).run()
      await db.prepare("INSERT OR IGNORE INTO intelligence_schema_migrations (version, applied_at) VALUES (2, ?)").run(Date.now())
    })()
    initialization.set(db, pending)
    // A failed migration is retriable. It is never reported as an available v2 database.
    pending.catch(() => initialization.delete(db))
  }
  await pending
}

export async function getIntelligenceStore() {
  let db: Database | undefined
  let initializationError: string | undefined
  try {
    db = useDatabase()
    await initialize(db)
  } catch {
    db = undefined
    initializationError = "数据库未绑定、不可用或结构初始化失败；本次运行仅使用临时缓存，历史信息由已有仓库快照提供。"
  }
  const database = db
  return {
    persistent: !!database,
    schemaVersion: intelligenceStoragePolicy.schemaVersion,
    initializationError,
    async get<T>(key: string): Promise<T | undefined> {
      if (!database) return temporary.get(key) as T | undefined
      const row = await database.prepare("SELECT data FROM intelligence_state_v1 WHERE id = ?").get(key) as { data: string } | undefined
      if (!row) return
      try { return JSON.parse(row.data) as T } catch { return }
    },
    async set(key: string, value: unknown) {
      if (!database) { memorySet(key, value); return }
      await database.prepare("INSERT INTO intelligence_state_v1 (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(key, JSON.stringify(value))
    },
    async save(input: IntelligenceArticle) {
      const article = intelligenceMetadataOnly(input)
      if (!database) { memorySet(`article:${article.key}`, article); return }
      await database.prepare(intelligenceSaveV2)
        .run(article.key, article.topic, article.publishedAt ?? null, article.collectedAt, JSON.stringify(article))
    },
    async remove(key: string) {
      if (!database) { temporary.delete(`article:${key}`); return }
      await database.prepare("DELETE FROM intelligence_documents_v1 WHERE id = ?").run(key)
    },
    async articles(topic: IntelligenceTopic): Promise<IntelligenceArticle[]> {
      if (!database) return [...temporary.entries()].filter(([k, v]) => k.startsWith("article:") && (v as IntelligenceArticle).topic === topic).map(([, v]) => v as IntelligenceArticle)
      // Migration failure must not hide legacy information. Writes still fail
      // loudly, rather than silently claiming that an unsaved article was stored.
      try { await database.prepare(intelligenceBackfillV2).run() } catch { /* Legacy read below remains available. */ }
      const rows = unpackRows(await database.prepare(intelligenceReadV2).all(topic, topic))
      return rows.flatMap(row => {
        try { return [intelligenceMetadataOnly(JSON.parse(row.data) as IntelligenceArticle)] } catch { return [] }
      })
    },
    async migrationStatus() {
      if (!database) return { applied: false, remaining: null, invalidLegacyRows: null }
      const row = await database.prepare(`SELECT
        SUM(CASE WHEN json_valid(old.data) AND NOT EXISTS
          (SELECT 1 FROM intelligence_documents_v2 d WHERE d.id=old.id) THEN 1 ELSE 0 END) AS remaining,
        SUM(CASE WHEN NOT json_valid(old.data) THEN 1 ELSE 0 END) AS invalid
        FROM intelligence_documents_v1 old`).get() as { remaining: number | null, invalid: number | null } | undefined
      return { applied: true, remaining: row?.remaining ?? 0, invalidLegacyRows: row?.invalid ?? 0 }
    },
  }
}
