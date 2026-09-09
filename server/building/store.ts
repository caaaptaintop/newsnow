import type { IntelligenceArticle } from "../../shared/intelligence"
import { BuildingError, buildingHash, buildingLimits, canonicalItems, normalizeBatchItem, publicArticle, type BatchItem } from "../../shared/building-contract"
import { intelligenceSources } from "../../shared/official-sources"
import { isPublishedSource } from "../../shared/public-site"
export interface Statement {
  bind(...values: any[]): Statement
  first<T = any>(column?: string): Promise<T | null>
  all<T = any>(): Promise<{ results: T[], meta?: any }>
  run(): Promise<any>
}
export interface BuildingDB {
  prepare(sql: string): Statement
  batch<T = any>(statements: Statement[]): Promise<Array<{ results: T[], meta?: any }>>
  withSession?: (constraint: string) => BuildingDB
}
export function buildingEnv(event: any): Record<string, any> { return event.context.cloudflare?.env ?? event.context.env ?? {} }
export function buildingDB(event: any): BuildingDB {
  const binding = buildingEnv(event).NEWSNOW_DB as BuildingDB | undefined
  if (!binding?.prepare || !binding.batch) throw new BuildingError(503, "资讯数据库暂不可用，请稍后重试")
  return binding.withSession ? binding.withSession("first-primary") : binding
}
export const buildingSchema = [
  `CREATE TABLE IF NOT EXISTS building_meta_v3 (topic TEXT PRIMARY KEY CHECK(topic='building'),revision INTEGER NOT NULL DEFAULT 0,published_at INTEGER,received_at INTEGER,total INTEGER NOT NULL DEFAULT 0,initialized INTEGER NOT NULL DEFAULT 0)`,
  `INSERT OR IGNORE INTO building_meta_v3(topic) VALUES ('building')`,
  `CREATE TABLE IF NOT EXISTS building_docs_v3 (id TEXT PRIMARY KEY,data TEXT NOT NULL CHECK(json_valid(data)),public_hash TEXT NOT NULL,title TEXT NOT NULL,source_id TEXT NOT NULL,source_group TEXT NOT NULL,region TEXT NOT NULL,city TEXT NOT NULL,category TEXT NOT NULL,content_type TEXT NOT NULL,importance INTEGER NOT NULL,published_at INTEGER,collected_at INTEGER NOT NULL,search_text TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS building_date_v3 ON building_docs_v3(COALESCE(published_at,0) DESC,collected_at DESC,id DESC)`,
  `CREATE INDEX IF NOT EXISTS building_rank_v3 ON building_docs_v3(importance DESC,COALESCE(published_at,0) DESC,collected_at DESC,id DESC)`,
  `CREATE INDEX IF NOT EXISTS building_location_v3 ON building_docs_v3(region,city)`,
  `CREATE INDEX IF NOT EXISTS building_source_v3 ON building_docs_v3(source_id)`,
  `CREATE INDEX IF NOT EXISTS building_type_v3 ON building_docs_v3(content_type)`,
  `CREATE TABLE IF NOT EXISTS building_seen_v3(id TEXT PRIMARY KEY,title TEXT NOT NULL,seen_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS building_sources_v3(id TEXT PRIMARY KEY,data TEXT NOT NULL CHECK(json_valid(data)),checked_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS building_receipts_v3(id TEXT PRIMARY KEY,owner TEXT NOT NULL,hash TEXT NOT NULL,revision INTEGER NOT NULL,created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS building_migration_v3(id INTEGER PRIMARY KEY CHECK(id=1),completed_at INTEGER NOT NULL,total INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS building_guards_v3(id TEXT PRIMARY KEY,ok INTEGER NOT NULL CHECK(ok=1))`,
  `CREATE TABLE IF NOT EXISTS building_policy_v3(id INTEGER PRIMARY KEY CHECK(id=1),relay_enabled INTEGER NOT NULL DEFAULT 1,per_minute INTEGER NOT NULL DEFAULT 6,per_day INTEGER NOT NULL DEFAULT 2000,bytes_per_day INTEGER NOT NULL DEFAULT 5368709120,concurrent INTEGER NOT NULL DEFAULT 20)`,
  `INSERT OR IGNORE INTO building_policy_v3(id) VALUES(1)`,
  `CREATE TABLE IF NOT EXISTS building_usage_v3(id TEXT PRIMARY KEY,requests INTEGER NOT NULL DEFAULT 0,reserved INTEGER NOT NULL DEFAULT 0,delivered INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS building_leases_v3(id TEXT PRIMARY KEY,day TEXT NOT NULL,ip_key TEXT NOT NULL,maximum INTEGER NOT NULL,expires INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS building_lease_ip_v3 ON building_leases_v3(ip_key,expires)`,
  `CREATE INDEX IF NOT EXISTS building_lease_expiry_v3 ON building_leases_v3(expires)`,
]
export async function initializeBuilding(db: BuildingDB) {
  // DDL is only called by the authenticated deployment operator, never by a reader.
  for (let i=0;i<buildingSchema.length;i+=10) await db.batch(buildingSchema.slice(i,i+10).map(sql=>db.prepare(sql)))
  return buildingMeta(db)
}
export async function buildingMeta(db: BuildingDB) {
  const row=await db.prepare("SELECT * FROM building_meta_v3 WHERE topic='building'").first<{revision:number,published_at:number|null,received_at:number|null,total:number,initialized:number}>()
  if (!row) throw new BuildingError(503,"资讯库尚未初始化")
  return { ...row, migrationComplete: !!await db.prepare("SELECT id FROM building_migration_v3 WHERE id=1").first() }
}
export async function publishBatch(db: BuildingDB,owner:string,body:any) {
  if(!body || typeof body.batchId!=="string" || !/^[\w-]{8,100}$/.test(body.batchId) || !Number.isSafeInteger(body.baseRevision) || body.baseRevision<0 || !Array.isArray(body.items) || !body.items.length || body.items.length>buildingLimits.batchItems) throw new BuildingError(400,"发布批次无效")
  const items:BatchItem[]=canonicalItems(body.items.map(normalizeBatchItem))
  if(new Set(items.map(i=>`${i.kind}:${i.key}`)).size!==items.length)throw new BuildingError(400,"批次含重复编号")
  const allowed=new Set(intelligenceSources.filter(isPublishedSource).map(s=>s.id))
  for(const i of items)if((i.kind==="article"&&!allowed.has(i.data.sourceId))||(i.kind==="source"&&!allowed.has(i.key)))throw new BuildingError(400,"来源未启用")
  const hash=await buildingHash(JSON.stringify([body.baseRevision,items]))
  const receipt=async()=>db.prepare("SELECT * FROM building_receipts_v3 WHERE id=?").bind(body.batchId).first<any>()
  const prior=await receipt()
  if(prior){if(prior.owner!==owner||prior.hash!==hash)throw new BuildingError(409,"批次编号已用于其他内容");return{revision:prior.revision,repeated:true}}
  const state=await buildingMeta(db)
  if(state.revision!==body.baseRevision)throw new BuildingError(409,"发布基线已更新，请核对后重试")
  const articleItems=items.filter(i=>i.kind==="article")
  const hashes=new Map<string,string>()
  for(const i of articleItems)hashes.set(i.key,await buildingHash(JSON.stringify(publicArticle(i.data))))
  const oldRows=articleItems.length?(await db.prepare(`SELECT id,public_hash,collected_at FROM building_docs_v3 WHERE id IN (${articleItems.map(()=>"?").join(",")})`).bind(...articleItems.map(i=>i.key)).all<any>()).results:[]
  const old=new Map(oldRows.map(r=>[r.id,r]))
  const visibleChange=articleItems.some(i=>!old.has(i.key)||(old.get(i.key).collected_at<=i.data.collectedAt&&old.get(i.key).public_hash!==hashes.get(i.key)))
  const now=Date.now(),guard=crypto.randomUUID(),revision=state.revision+(visibleChange||!state.initialized?1:0)
  const statements=[db.prepare(`INSERT INTO building_guards_v3 VALUES(?,CASE WHEN (SELECT revision FROM building_meta_v3 WHERE topic='building')=? AND NOT EXISTS(SELECT 1 FROM building_receipts_v3 WHERE id=?) THEN 1 ELSE 0 END)`).bind(guard,body.baseRevision,body.batchId)]
  for(const i of items){const d=i.data
    if(i.kind==="article"){
      const search=`${d.title} ${d.summary} ${d.documentNo??""} ${d.sourceName} ${d.tags.join(" ")}`.toLocaleLowerCase()
      statements.push(db.prepare(`INSERT INTO building_docs_v3(id,data,public_hash,title,source_id,source_group,region,city,category,content_type,importance,published_at,collected_at,search_text) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,public_hash=excluded.public_hash,title=excluded.title,source_id=excluded.source_id,source_group=excluded.source_group,region=excluded.region,city=excluded.city,category=excluded.category,content_type=excluded.content_type,importance=excluded.importance,published_at=excluded.published_at,collected_at=excluded.collected_at,search_text=excluded.search_text WHERE excluded.collected_at>=building_docs_v3.collected_at`).bind(i.key,JSON.stringify(d),hashes.get(i.key),d.title,d.sourceId,d.sourceGroup,d.region,d.city,d.category,d.contentType,d.importance,d.publishedAt??null,d.collectedAt,search))
    }else if(i.kind==="decision")statements.push(db.prepare(`INSERT INTO building_seen_v3 VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,seen_at=excluded.seen_at WHERE excluded.seen_at>=building_seen_v3.seen_at`).bind(i.key,d.title,d.at))
    else statements.push(db.prepare(`INSERT INTO building_sources_v3 VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,checked_at=excluded.checked_at WHERE excluded.checked_at>=building_sources_v3.checked_at`).bind(i.key,JSON.stringify(d),d.checkedAt))
  }
  statements.push(db.prepare(`UPDATE building_meta_v3 SET revision=?,published_at=?,received_at=?,initialized=1,total=(SELECT COUNT(*) FROM building_docs_v3) WHERE topic='building'`).bind(revision,visibleChange||!state.initialized?now:state.published_at,now))
  statements.push(db.prepare("INSERT INTO building_receipts_v3 VALUES(?,?,?,?,?)").bind(body.batchId,owner,hash,revision,now))
  statements.push(db.prepare("DELETE FROM building_guards_v3 WHERE id=?").bind(guard))
  try{await db.batch(statements)}catch(error){
    const after=await receipt()
    if(after&&after.owner===owner&&after.hash===hash)return{revision:after.revision,repeated:true}
    if((await buildingMeta(db)).revision!==body.baseRevision)throw new BuildingError(409,"发布基线已变化，批次未写入")
    throw error
  }
  return{revision,repeated:false}
}
export async function knownRecords(db:BuildingDB,keys:any){
  if(!Array.isArray(keys)||keys.length>80||keys.some(k=>typeof k!=="string"||!/^building:[a-f0-9]{64}$/.test(k)))throw new BuildingError(400,"去重查询无效")
  if(!keys.length)return{records:[]}
  const placeholders=keys.map(()=>"?").join(",")
  const result=await db.batch([
    db.prepare(`SELECT id AS key,title,collected_at AS at FROM building_docs_v3 WHERE id IN (${placeholders})`).bind(...keys),
    db.prepare(`SELECT id AS key,title,seen_at AS at FROM building_seen_v3 WHERE id IN (${placeholders})`).bind(...keys),
  ])
  const rows=new Map<string,any>()
  for(const r of [...result[0].results,...result[1].results])if(!rows.has(r.key)||rows.get(r.key).at<r.at)rows.set(r.key,r)
  return{records:[...rows.values()]}
}
export async function articleById(db:BuildingDB,key:string):Promise<IntelligenceArticle|undefined>{
  if(!/^building:[a-f0-9]{64}$/.test(key))return undefined
  const row=await db.prepare("SELECT data FROM building_docs_v3 WHERE id=?").bind(key).first<{data:string}>()
  return row?JSON.parse(row.data):undefined
}

/** Activation is one transaction; no reader can see a partly seeded database. */
export async function activateBuilding(db:BuildingDB,expectedTotal:number,revision:number){
  if(!Number.isSafeInteger(expectedTotal)||expectedTotal<1||!Number.isSafeInteger(revision)||revision<1)throw new BuildingError(400,"迁移验收参数无效")
  const guard=crypto.randomUUID()
  try{await db.batch([
    db.prepare(`INSERT INTO building_guards_v3 VALUES(?,CASE WHEN
      (SELECT initialized FROM building_meta_v3 WHERE topic='building')=1 AND
      (SELECT total FROM building_meta_v3 WHERE topic='building')=? AND
      (SELECT COUNT(*) FROM building_docs_v3)=? AND
      (SELECT revision FROM building_meta_v3 WHERE topic='building')=? THEN 1 ELSE 0 END)`).bind(guard,expectedTotal,expectedTotal,revision),
    db.prepare("INSERT OR REPLACE INTO building_migration_v3(id,completed_at,total) VALUES(1,?,?)").bind(Date.now(),expectedTotal),
    db.prepare("DELETE FROM building_guards_v3 WHERE id=?").bind(guard),
  ])}catch(error){if(/CHECK constraint failed/i.test(String(error)))throw new BuildingError(409,"迁移验收数量或版本不一致");throw error}
  return{ready:true,total:expectedTotal}
}
