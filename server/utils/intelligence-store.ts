import type { Database } from "db0"
import type { IntelligenceArticle, IntelligenceTopic } from "@shared/intelligence"

const temporary = new Map<string, unknown>()
const initialized = new WeakSet<object>()
function unpackRows(result: any): any[] { return Array.isArray(result) ? result : result?.results ?? [] }
function memorySet(key: string, value: unknown) {
  temporary.set(key, value)
  while (temporary.size > 3000) temporary.delete(temporary.keys().next().value!)
}
export async function getIntelligenceStore() {
  let db: Database | undefined
  try {
    db = useDatabase()
    if (!initialized.has(db)) {
      await db.prepare("CREATE TABLE IF NOT EXISTS intelligence_documents_v1 (id TEXT PRIMARY KEY, topic TEXT NOT NULL, published INTEGER, collected INTEGER NOT NULL, data TEXT NOT NULL)").run()
      await db.prepare("CREATE INDEX IF NOT EXISTS intelligence_documents_topic_v1 ON intelligence_documents_v1 (topic, published)").run()
      await db.prepare("CREATE TABLE IF NOT EXISTS intelligence_state_v1 (id TEXT PRIMARY KEY, data TEXT NOT NULL)").run()
      initialized.add(db)
    }
  } catch {
    db = undefined
  }
  const database = db
  return {
    persistent: !!database,
    async get<T>(key: string): Promise<T | undefined> {
      if (!database) return temporary.get(key) as T | undefined
      const row = await database.prepare("SELECT data FROM intelligence_state_v1 WHERE id = ?").get(key) as { data: string } | undefined
      if (!row) return
      try { return JSON.parse(row.data) as T } catch { return }
    },
    async set(key: string, value: unknown) {
      if (!database) { memorySet(key, value); return }
      await database.prepare("INSERT OR REPLACE INTO intelligence_state_v1 (id, data) VALUES (?, ?)").run(key, JSON.stringify(value))
    },
    async save(article: IntelligenceArticle) {
      if (!database) { memorySet(`article:${article.key}`, article); return }
      await database.prepare("INSERT OR REPLACE INTO intelligence_documents_v1 (id, topic, published, collected, data) VALUES (?, ?, ?, ?, ?)")
        .run(article.key, article.topic, article.publishedAt ?? null, article.collectedAt, JSON.stringify(article))
    },
    async remove(key: string) {
      if (!database) { temporary.delete(`article:${key}`); return }
      await database.prepare("DELETE FROM intelligence_documents_v1 WHERE id = ?").run(key)
    },
    async articles(topic: IntelligenceTopic): Promise<IntelligenceArticle[]> {
      if (!database) return [...temporary.entries()].filter(([k, v]) => k.startsWith("article:") && (v as IntelligenceArticle).topic === topic).map(([, v]) => v as IntelligenceArticle)
      const rows = unpackRows(await database.prepare("SELECT data FROM intelligence_documents_v1 WHERE topic = ? ORDER BY COALESCE(published, 0) DESC, collected DESC LIMIT 5001").all(topic))
      return rows.flatMap(row => { try { return [JSON.parse(row.data) as IntelligenceArticle] } catch { return [] } })
    },
  }
}
