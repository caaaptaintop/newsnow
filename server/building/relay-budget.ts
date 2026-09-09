import { buildingHash,BuildingError } from "../../shared/building-contract"
import { buildingMeta,type BuildingDB } from "./store"
export async function reserveRelay(db:BuildingDB,ip:string,salt:string,maximum:number,now=Date.now()){
  if(!salt)throw new BuildingError(503,"附件转发尚未配置，请使用原站入口")
  const day=`day:${Math.floor(now/86400000)}`,ipKey=await buildingHash(`${salt}:${day}:${ip}`),minute=`minute:${Math.floor(now/60000)}:${ipKey}`
  const policy=await db.prepare("SELECT * FROM building_policy_v3 WHERE id=1").first<any>()
  if(!policy?.relay_enabled)throw new BuildingError(503,"附件转发暂时关闭，请使用原站入口")
  const id=crypto.randomUUID(),guard=crypto.randomUUID()
  try{await db.batch([
    db.prepare("INSERT OR IGNORE INTO building_usage_v3(id) VALUES(?)").bind(day),db.prepare("INSERT OR IGNORE INTO building_usage_v3(id) VALUES(?)").bind(minute),
    db.prepare(`INSERT INTO building_guards_v3 VALUES(?,CASE WHEN
      (SELECT relay_enabled FROM building_policy_v3 WHERE id=1)=1 AND
      (SELECT requests FROM building_usage_v3 WHERE id=?)<(SELECT per_day FROM building_policy_v3 WHERE id=1) AND
      (SELECT reserved FROM building_usage_v3 WHERE id=?)+?<=(SELECT bytes_per_day FROM building_policy_v3 WHERE id=1) AND
      (SELECT requests FROM building_usage_v3 WHERE id=?)<(SELECT per_minute FROM building_policy_v3 WHERE id=1) AND
      (SELECT COUNT(*) FROM building_leases_v3 WHERE expires>?)<(SELECT concurrent FROM building_policy_v3 WHERE id=1) AND
      (SELECT COUNT(*) FROM building_leases_v3 WHERE ip_key=? AND expires>?)<2 THEN 1 ELSE 0 END)`).bind(guard,day,day,maximum,minute,now,ipKey,now),
    db.prepare("UPDATE building_usage_v3 SET requests=requests+1,reserved=reserved+? WHERE id=?").bind(maximum,day),
    db.prepare("UPDATE building_usage_v3 SET requests=requests+1 WHERE id=?").bind(minute),
    db.prepare("INSERT INTO building_leases_v3 VALUES(?,?,?,?,?)").bind(id,day,ipKey,maximum,now+90000),
    db.prepare("DELETE FROM building_guards_v3 WHERE id=?").bind(guard),
  ])}catch(error){if(/CHECK constraint failed/i.test(String(error)))throw new BuildingError(429,"预览请求过于频繁或今日转发额度已用完，请稍后重试或从原站打开");throw new BuildingError(503,"转发额度服务暂不可用，请使用原站入口")}
  return id
}
export async function settleRelay(db:BuildingDB,id:string,actual:number,failed:boolean){
  const bytes=Math.max(0,Math.floor(actual))
  // Lost settlement retains the full reservation. Lease expiry never refunds unknown consumption.
  await db.batch([
    db.prepare(`UPDATE building_usage_v3 SET reserved=reserved-(SELECT maximum-MIN(maximum,?) FROM building_leases_v3 WHERE id=?),delivered=delivered+(SELECT MIN(maximum,?) FROM building_leases_v3 WHERE id=?),failures=failures+? WHERE id=(SELECT day FROM building_leases_v3 WHERE id=?)`).bind(bytes,id,bytes,id,failed?1:0,id),
    db.prepare("DELETE FROM building_leases_v3 WHERE id=?").bind(id),
  ])
}
export async function relayPolicy(db:BuildingDB,body:any){
  if(!body||typeof body.enabled!=="boolean")throw new BuildingError(400,"请明确设置转发启停状态")
  const p=await db.prepare("SELECT * FROM building_policy_v3 WHERE id=1").first<any>()
  const perMinute=body.perMinute??p.per_minute,perDay=body.perDay??p.per_day,bytesPerDay=body.bytesPerDay??p.bytes_per_day,concurrent=body.concurrent??p.concurrent
  if(![perMinute,perDay,bytesPerDay,concurrent].every(Number.isSafeInteger)||perMinute<1||perMinute>60||perDay<1||perDay>100000||bytesPerDay<20971520||bytesPerDay>107374182400||concurrent<1||concurrent>100)throw new BuildingError(400,"转发限额超出允许范围")
  await db.prepare("UPDATE building_policy_v3 SET relay_enabled=?,per_minute=?,per_day=?,bytes_per_day=?,concurrent=? WHERE id=1").bind(body.enabled?1:0,perMinute,perDay,bytesPerDay,concurrent).run()
  return{enabled:body.enabled,perMinute,perDay,bytesPerDay,concurrent}
}
export async function buildingStatus(db:BuildingDB){
  const publication=await buildingMeta(db)
  const r=await db.batch([db.prepare("SELECT * FROM building_policy_v3 WHERE id=1"),db.prepare("SELECT * FROM building_usage_v3 WHERE id LIKE 'day:%' ORDER BY id DESC LIMIT 7"),db.prepare("SELECT id,data,checked_at FROM building_sources_v3 ORDER BY id")])
  return{database:"D1",publication,relay:r[0].results[0],usage:r[1].results,sources:r[2].results}
}
export async function maintainBuilding(db:BuildingDB){
  await db.batch([
    db.prepare("DELETE FROM building_leases_v3 WHERE id IN (SELECT id FROM building_leases_v3 WHERE expires<? LIMIT 200)").bind(Date.now()-86400000),
    db.prepare("DELETE FROM building_usage_v3 WHERE id IN (SELECT id FROM building_usage_v3 WHERE (id LIKE 'minute:%' AND id<?) OR (id LIKE 'day:%' AND id<?) LIMIT 200)").bind(`minute:${Math.floor((Date.now()-86400000)/60000)}:`,`day:${Math.floor((Date.now()-8*86400000)/86400000)}`),
  ])
}
