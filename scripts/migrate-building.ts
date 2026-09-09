import { readFile,writeFile } from "node:fs/promises"
import { intelligenceDedupe,type IntelligenceArticle } from "../shared/intelligence"
import { intelligenceSources } from "../shared/official-sources"
import { isPublishedSource } from "../shared/public-site"
import { buildingHash,buildingLimits,normalizeBatchItem,type BatchItem } from "../shared/building-contract"
const base=process.env.BUILDING_RELEASE_URL!,token=process.env.BUILDING_RELEASE_TOKEN!
if(!base?.startsWith("https://")||!/^[a-f0-9]{64}$/.test(token??""))throw new Error("Release configuration missing")
async function request(body:any){
  let response:Response|undefined
  for(let i=0;i<3;i++){
    try{response=await fetch(`${base}/api/internal/building`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(60000),redirect:"error"});if(response.status<500)break}catch{}
    await new Promise(r=>setTimeout(r,2000))
  }
  if(!response?.ok)throw new Error(`Building migration ${body.action}: HTTP ${response?.status??0}`)
  return response.json() as Promise<any>
}
const state=await request({action:"init"})
if(state.migrationComplete){
  const status=await request({action:"status"})
  if(!status.publication.initialized||status.publication.total<1)throw new Error("Initialized database is unexpectedly empty")
  console.log(JSON.stringify({migration:"already-complete",records:status.publication.total,revision:status.publication.revision}))
}else{
  const archive=JSON.parse(await readFile("data/intelligence-snapshot.json","utf8"))
  const live=JSON.parse(await readFile(process.env.BUILDING_CAPTURE_PATH!,"utf8"))
  const legacy:any[]=[]
  for(const table of ["v1","v2"]){let after="";do{const page=await request({action:"legacy",table,after});legacy.push(...page.articles);after=page.after}while(after)}
  const allowed=new Set(intelligenceSources.filter(isPublishedSource).map(s=>s.id))
  // Retain current public corrections first. Archive and legacy rows fill missing records.
  const inputs=[...live.articles,...archive.articles,...legacy].filter(a=>a.topic==="building"&&allowed.has(a.sourceId))
  const normalized=inputs.map(a=>normalizeBatchItem({kind:"article",key:a.key,data:a}).data as IntelligenceArticle)
  const articles=intelligenceDedupe(normalized)
  if(!articles.length||articles.length<live.articles.length)throw new Error("Migration would unexpectedly reduce existing public record count")
  const items:BatchItem[]=articles.map(a=>normalizeBatchItem({kind:"article",key:a.key,data:a}))
  const states=(archive.states??[]).filter((s:any)=>allowed.has(s.id)&&["ok","partial","error"].includes(s.status)).map((s:any)=>normalizeBatchItem({kind:"source",key:s.id,data:s}))
  for(const chunk of [items,states])for(let i=0;i<chunk.length;i+=buildingLimits.batchItems){
    const batch=chunk.slice(i,i+buildingLimits.batchItems),hash=await buildingHash(JSON.stringify(batch)),version=await request({action:"version"})
    await request({action:"publish",batchId:`seed_${hash.slice(0,32)}_${version.revision}`,baseRevision:version.revision,items:batch})
  }
  const final=await request({action:"version"}),stored=new Map<string,any>();let after=""
  do{const page=await request({action:"export",after,revision:final.revision});for(const a of page.articles)stored.set(a.key,a);after=page.after}while(after)
  for(const item of items){const saved=stored.get(item.key);if(!saved||JSON.stringify(normalizeBatchItem({kind:"article",key:item.key,data:saved}))!==JSON.stringify(item))throw new Error("Migrated metadata does not match validated input")}
  await request({action:"activate",expectedTotal:stored.size,revision:final.revision})
  console.log(JSON.stringify({migration:"complete",archiveBuilding:archive.articles.filter((a:any)=>a.topic==="building").length,legacyRows:legacy.length,capturedPublic:live.articles.length,records:stored.size,revision:final.revision,rawContentStored:false}))
}
const ready=await request({action:"version"})
if(!ready.migrationComplete)throw new Error("Migration activation missing")
// The signed endpoint must be inaccessible to anonymous readers.
const denied=await fetch(`${base}/api/internal/building`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"status"})})
if(denied.status!==401)throw new Error("Anonymous publishing endpoint was not rejected")
await writeFile("/tmp/building-release-evidence.json",JSON.stringify({database:"D1",migrationComplete:true,total:ready.total,revision:ready.revision,anonymousPublisher:denied.status,attachmentBytesRequested:0}))
