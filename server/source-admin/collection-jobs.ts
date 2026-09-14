import { type H3Event, createError } from "h3"
import { sourceConfigDatabase } from "../utils/source-config-store"

export const collectionSchedule = "每日05:00、12:00、16:00（北京时间）"
type Database = ReturnType<typeof sourceConfigDatabase>
interface JobRow {
  id: string
  state: string
  requested_at: number
  started_at: number | null
  finished_at: number | null
  message: string
  owner: string | null
}
function invalid() {
  return createError({ statusCode: 400, message: "采集任务参数无效" })
}
function conflict() {
  return createError({ statusCode: 409, message: "采集任务状态或执行者不匹配" })
}
function view(row: JobRow | null) {
  return row ? { id: row.id, state: row.state, requestedAt: row.requested_at, startedAt: row.started_at, finishedAt: row.finished_at, message: row.message } : null
}
async function first(db: Database, sql: string, ...args: unknown[]) {
  const result = await db.prepare(sql).bind(...args).all()
  if (!Array.isArray(result.results)) throw createError({ statusCode: 503, message: "采集任务读取失败" })
  return (result.results[0] ?? null) as unknown as JobRow | null
}
async function exists(db: Database) {
  return !!await first(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='building_collection_jobs'")
}
async function ensureSchema(db: Database) {
  // Called only after an authenticated administrator requests collection.
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS building_collection_jobs (
      id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('queued','running','complete','error')),
      requested_at INTEGER NOT NULL, requested_by TEXT NOT NULL, started_at INTEGER, finished_at INTEGER,
      owner TEXT, message TEXT NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS building_collection_one_active ON building_collection_jobs ((1)) WHERE state IN ('queued','running')"),
  ])
}
export async function collectionStatus(event: H3Event) {
  const db = sourceConfigDatabase(event)
  const job = await exists(db) ? await first(db, "SELECT * FROM building_collection_jobs ORDER BY CASE WHEN state IN ('queued','running') THEN 0 ELSE 1 END, requested_at DESC, rowid DESC LIMIT 1") : null
  return { job: view(job), schedule: collectionSchedule }
}
export async function requestCollection(event: H3Event, email: string) {
  const db = sourceConfigDatabase(event)
  await ensureSchema(db)
  const results = await db.batch([
    db.prepare("INSERT OR IGNORE INTO building_collection_jobs (id,state,requested_at,requested_by,message) VALUES (?,'queued',?,?,?)")
      .bind(crypto.randomUUID(), Date.now(), email, "等待 Mac 后台接收；离线或休眠时暂不执行"),
    db.prepare("SELECT * FROM building_collection_jobs WHERE state IN ('queued','running') LIMIT 1"),
  ])
  const row = results[1].results?.[0] as unknown as JobRow | undefined
  if (!row) throw conflict()
  return { job: view(row), schedule: collectionSchedule }
}
export async function pollCollection(event: H3Event) {
  const db = sourceConfigDatabase(event)
  return { job: view(await exists(db) ? await first(db, "SELECT * FROM building_collection_jobs WHERE state='queued' LIMIT 1") : null) }
}
function id(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw invalid()
  return value
}
export async function claimCollection(event: H3Event, owner: string, value: unknown) {
  const jobId = id(value)
  const db = sourceConfigDatabase(event)
  if (!owner || owner === "deployment") throw conflict()
  if (!await exists(db)) return { claimed: false, job: null }
  const claimed = await first(db, "UPDATE building_collection_jobs SET state='running', owner=?, started_at=?, message=? WHERE id=? AND state='queued' RETURNING *", owner, Date.now(), "Mac 正在采集；长时间未完成需人工检查，不会自动重跑", jobId)
  return { claimed: !!claimed, job: view(claimed ?? await first(db, "SELECT * FROM building_collection_jobs WHERE id=?", jobId)) }
}
export async function finishCollection(event: H3Event, owner: string, value: Record<string, unknown>) {
  const jobId = id(value.id)
  const state = value.state
  const message = value.message
  if (typeof state !== "string" || !["complete", "error"].includes(state) || typeof message !== "string" || !message.trim() || message.length > 500) throw invalid()
  if (!owner || owner === "deployment") throw conflict()
  const db = sourceConfigDatabase(event)
  if (!await exists(db)) throw conflict()
  const finished = await first(db, "UPDATE building_collection_jobs SET state=?, finished_at=?, message=? WHERE id=? AND state='running' AND owner=? RETURNING *", state, Date.now(), message, jobId, owner)
  const row = finished ?? await first(db, "SELECT * FROM building_collection_jobs WHERE id=?", jobId)
  if (!row || row.owner !== owner || row.state !== state || row.message !== message) throw conflict()
  return { job: view(row) }
}
