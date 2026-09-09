import { beforeEach,afterEach,describe,it,expect } from "vitest"
import { createHash } from "node:crypto"
import { memoryBuildingDB } from "./helpers/building-db"
import { initializeBuilding,publishBatch,knownRecords,buildingMeta } from "../server/building/store"
import { readPage,readVersion } from "../server/building/read"
import { reserveRelay,settleRelay,relayPolicy,buildingStatus,maintainBuilding } from "../server/building/relay-budget"
import { normalizeBatchItem,locationCityId,buildingLimits } from "../shared/building-contract"
const now=1788960000000
function article(i:number,extra:any={}){
  const key=`building:${createHash("sha256").update(String(i)).digest("hex")}`
  return normalizeBatchItem({kind:"article",key,data:{key,topic:"building",title:`建筑测试通知${i}`,url:`https://zjt.jiangsu.gov.cn/a/${i}`,sourceId:"official-jiangsu",sourceName:"江苏住建",sourceGroup:"住建官方",sourceLevel:"省级",region:"江苏",city:i%2?"南京":"苏州",column:"通知",publishedAt:now-i*1000,collectedAt:now,publicationDate:{status:"verified",basis:"article",url:`https://zjt.jiangsu.gov.cn/a/${i}`,checkedAt:now},category:"intelligent_construction",relatedCategories:["policy"],tags:["BIM"],contentType:"通知公告",importance:80,summary:"建筑资讯摘要",evidence:"title",attachments:[],model:"unit-test-model",analysisVersion:"v3-test",...extra}})
}
let memory:ReturnType<typeof memoryBuildingDB>,counter=0
beforeEach(async()=>{memory=memoryBuildingDB();await initializeBuilding(memory.db)})
afterEach(()=>memory.sqlite.close())
async function publish(items:any[]){let result:any;for(let i=0;i<items.length;i+=buildingLimits.batchItems)result=await publishBatch(memory.db,"test",{batchId:`testbatch_${++counter}`,baseRevision:(await buildingMeta(memory.db)).revision,items:items.slice(i,i+buildingLimits.batchItems)});return result}
describe("atomic metadata publication",()=>{
  it("publishes a complete transaction and makes retries idempotent",async()=>{
    const body={batchId:"atomic_001",baseRevision:0,items:[article(1),article(2)]}
    expect((await publishBatch(memory.db,"test",body)).revision).toBe(1)
    expect((await publishBatch(memory.db,"test",body)).repeated).toBe(true)
    expect((await readVersion(memory.db)).version).toBe("1")
  })
  it("rolls back every row when a statement fails mid-batch",async()=>{
    memory.sqlite.exec(`CREATE TRIGGER reject_second BEFORE INSERT ON building_docs_v3 WHEN NEW.id='${article(2).key}' BEGIN SELECT RAISE(ABORT,'synthetic failure');END`)
    await expect(publish([article(1),article(2)])).rejects.toThrow()
    expect(await memory.db.prepare("SELECT COUNT(*) AS n FROM building_docs_v3").first("n")).toBe(0)
    expect((await buildingMeta(memory.db)).revision).toBe(0)
    expect(await memory.db.prepare("SELECT COUNT(*) AS n FROM building_receipts_v3").first("n")).toBe(0)
  })
  it("rejects batch-id reuse with changed payload or owner",async()=>{
    const body={batchId:"identity_01",baseRevision:0,items:[article(1)]}
    await publishBatch(memory.db,"test",body)
    await expect(publishBatch(memory.db,"other",body)).rejects.toMatchObject({statusCode:409})
    await expect(publishBatch(memory.db,"test",{...body,items:[article(2)]})).rejects.toMatchObject({statusCode:409})
  })
  it("rejects a stale publication base before modifying data",async()=>{
    await publish([article(2)])
    await expect(publishBatch(memory.db,"test",{batchId:"stale_001",baseRevision:0,items:[article(1)]})).rejects.toMatchObject({statusCode:409})
    expect((await readPage(memory.db,new URLSearchParams(),now)).articles.map(a=>a.key)).toEqual([article(2).key])
  })
  it("state-only, rejected decisions and identical articles do not change public version",async()=>{
    await publish([article(1)]);const v=await readVersion(memory.db)
    await publish([normalizeBatchItem({kind:"decision",key:article(3).key,data:{title:"排除的候选",at:now}}),normalizeBatchItem({kind:"source",key:"official-jiangsu",data:{status:"error",checkedAt:now,error:"not-stored"}})])
    await publish([article(1)])
    expect(await readVersion(memory.db)).toEqual(v)
    expect((await knownRecords(memory.db,[article(3).key])).records[0].title).toBe("排除的候选")
    expect(JSON.stringify(await buildingStatus(memory.db))).not.toContain("not-stored")
  })
  it("late older records cannot replace newer corrections",async()=>{
    await publish([article(1,{collectedAt:now+100,title:"新修正"})]);await publish([article(1,{title:"旧数据"})])
    expect((await readPage(memory.db,new URLSearchParams(),now)).articles[0].title).toBe("新修正")
  })
  it("strips original text and file bytes; public projection hides model details",async()=>{
    const a=article(1,{body:"neverpersist",html:"neverpersist",fileBytes:"neverpersist",settings:{secret:"neverpersist"}})
    expect(JSON.stringify(a)).not.toContain("neverpersist");await publish([a])
    expect(JSON.stringify(await readPage(memory.db,new URLSearchParams(),now))).not.toContain("unit-test-model")
  })
  it("rejects disabled topics, duplicate IDs and unknown sources",async()=>{
    expect(()=>article(1,{topic:"health"})).toThrow()
    await expect(publish([article(1),article(1)])).rejects.toMatchObject({statusCode:400})
    await expect(publish([article(1,{sourceId:"unknown-source"})])).rejects.toMatchObject({statusCode:400})
  })
})
describe("SQL pagination and full-range filters",()=>{
  it("returns true pages with no duplicates and full totals",async()=>{
    await publish(Array.from({length:115},(_,i)=>article(i)))
    const first=await readPage(memory.db,new URLSearchParams(),now);expect(first.articles).toHaveLength(50);expect(first.total).toBe(115)
    const second=await readPage(memory.db,new URLSearchParams({cursor:first.nextCursor!}),now);expect(second.articles).toHaveLength(50)
    const third=await readPage(memory.db,new URLSearchParams({cursor:second.nextCursor!}),now);expect(third.articles).toHaveLength(15);expect(third.nextCursor).toBeNull()
    expect(new Set([...first.articles,...second.articles,...third.articles].map(a=>a.key)).size).toBe(115)
  })
  it("searches beyond the first page and treats SQL wildcards literally",async()=>{
    await publish(Array.from({length:70},(_,i)=>article(i,i===69?{summary:"稀有检索字符 100%_"}:{})))
    expect((await readPage(memory.db,new URLSearchParams({q:"稀有检索字符"}),now)).articles).toHaveLength(1)
    expect((await readPage(memory.db,new URLSearchParams({q:"100%_"}),now)).articles).toHaveLength(1)
    expect((await readPage(memory.db,new URLSearchParams({q:"' OR 1=1 --"}),now)).articles).toHaveLength(0)
  })
  it("matches province OR qualified city without same-name city collisions",async()=>{
    await publish([article(1),article(2),article(3,{region:"浙江",city:"杭州"}),article(4,{region:"其他",city:"杭州"})])
    const page=await readPage(memory.db,new URLSearchParams({regions:"江苏",cities:locationCityId("浙江","杭州")}),now)
    expect(page.total).toBe(3);expect(page.facets.locations.some(g=>g.region==="其他")).toBe(true)
  })
  it("rejects cursors from older publications or changed filters",async()=>{
    await publish([article(1),article(2)])
    const page=await readPage(memory.db,new URLSearchParams({limit:"1"}),now)
    await expect(readPage(memory.db,new URLSearchParams({limit:"1",cursor:page.nextCursor!,q:"new"}),now)).rejects.toMatchObject({statusCode:409})
    await publish([article(3)])
    await expect(readPage(memory.db,new URLSearchParams({limit:"1",cursor:page.nextCursor!}),now)).rejects.toMatchObject({statusCode:409})
  })
  it("does not use collection time for unverified publication dates",async()=>{
    await publish([article(1),article(2,{publicationDate:{status:"unknown",url:"https://zjt.jiangsu.gov.cn/a",checkedAt:now}})])
    expect((await readPage(memory.db,new URLSearchParams({days:"7"}),now)).articles).toHaveLength(1)
  })
  it("supports related categories, tags, group filters and ranked cursors",async()=>{
    await publish([article(1,{importance:90}),article(2,{importance:90}),article(3,{importance:60})])
    const params=new URLSearchParams({category:"policy",tags:"BIM",sources:"住建官方",importance:"80",sort:"importance",limit:"1"})
    const first=await readPage(memory.db,params,now);expect(first.total).toBe(2);params.set("cursor",first.nextCursor!)
    const second=await readPage(memory.db,params,now);expect(second.articles[0].key).not.toBe(first.articles[0].key)
  })
  it.each([{limit:"101"},{sort:"bad"},{days:"3"},{category:"constructor"},{cursor:"broken"}])("rejects invalid queries %j",async query=>{await publish([article(1)]);await expect(readPage(memory.db,new URLSearchParams(query),now)).rejects.toMatchObject({statusCode:400})})
})
describe("durable relay limits",()=>{
  it("enforces concurrent reservations with idempotent settlement",async()=>{
    const size=20*1024*1024,one=await reserveRelay(memory.db,"ip","salt",size,now),two=await reserveRelay(memory.db,"ip","salt",size,now)
    await expect(reserveRelay(memory.db,"ip","salt",size,now)).rejects.toMatchObject({statusCode:429})
    await settleRelay(memory.db,one,1024,false);await settleRelay(memory.db,one,1024,false)
    const stats=await buildingStatus(memory.db);expect(stats.usage[0].reserved).toBe(size+1024);expect(stats.usage[0].delivered).toBe(1024)
    await settleRelay(memory.db,two,0,true)
  })
  it("does not refund unknown consumption when a lease expires",async()=>{
    const size=20*1024*1024;await relayPolicy(memory.db,{enabled:true,bytesPerDay:size})
    await reserveRelay(memory.db,"one","salt",size,now)
    await expect(reserveRelay(memory.db,"other","salt",size,now+100000)).rejects.toMatchObject({statusCode:429})
  })
  it("pause stops new relays without stopping public reads",async()=>{
    await publish([article(1)]);await relayPolicy(memory.db,{enabled:false})
    await expect(reserveRelay(memory.db,"ip","salt",1024,now)).rejects.toMatchObject({statusCode:503})
    expect((await readPage(memory.db,new URLSearchParams(),now)).articles).toHaveLength(1)
    await relayPolicy(memory.db,{enabled:true});expect(await reserveRelay(memory.db,"ip","salt",1024,now)).toBeTruthy()
  })
  it("bounded maintenance preserves public metadata",async()=>{await publish([article(1)]);await maintainBuilding(memory.db);expect((await readPage(memory.db,new URLSearchParams(),now)).articles).toHaveLength(1)})
})
