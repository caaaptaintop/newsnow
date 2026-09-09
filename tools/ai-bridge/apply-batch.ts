import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { mergeBatch } from "./merge-batch"
import { publisherRequest,atomicJson } from "./publisher.mjs"
import { canonicalItems,normalizeBatchItem,buildingHash,buildingLimits,type BatchItem } from "../../shared/building-contract"
import { isPublishedSource } from "../../shared/public-site"
import { intelligenceSources } from "../../shared/official-sources"
const root=resolve(import.meta.dirname,"../.."),dir=resolve(root,".data/mac-batch"),path=resolve(dir,"published.json")
const snapshot=JSON.parse(await readFile(path,"utf8")),batch=JSON.parse(await readFile(resolve(dir,"result.json"),"utf8")),result=mergeBatch(snapshot,batch)
const sources=new Set(intelligenceSources.filter(isPublishedSource).map(s=>s.id)),ledgerPath=resolve(dir,"published-ledger.json"),outboxPath=resolve(dir,"publish-outbox.json")
const read=async(path:string,fallback:any)=>{try{return JSON.parse(await readFile(path,"utf8"))}catch(error:any){if(error.code!=="ENOENT")throw error;return fallback}}
const ledger=await read(ledgerPath,{})
const old=new Map<string,string>(snapshot.articles.filter((a:any)=>a.topic==="building").map((a:any)=>[a.key,JSON.stringify(normalizeBatchItem({kind:"article",key:a.key,data:a}))]))
let items:BatchItem[]=[]
for(const a of result.articles)if(a.topic==="building"&&sources.has(a.sourceId)){const item=normalizeBatchItem({kind:"article",key:a.key,data:a});if(old.get(a.key)!==JSON.stringify(item))items.push(item)}
for(const d of batch.decisions??[])if(sources.has(d.sourceId)&&/^building:[a-f0-9]{64}$/.test(d.key)&&typeof d.title==="string")items.push(normalizeBatchItem({kind:"decision",key:d.key,data:{title:d.title,at:d.at}}))
for(const s of batch.states??[])if(sources.has(s.id))items.push(normalizeBatchItem({kind:"source",key:s.id,data:s}))
items=canonicalItems(items.filter(item=>ledger[`${item.kind}:${item.key}`]!==JSON.stringify(item)))
let published=0
for(let i=0;i<items.length;i+=buildingLimits.batchItems){
  const chunk=items.slice(i,i+buildingLimits.batchItems),hash=await buildingHash(JSON.stringify(chunk))
  let outbox=await read(outboxPath,null)
  if(!outbox||outbox.hash!==hash){const version=await publisherRequest({action:"version"});if(!version||typeof version!=="object"||!("revision" in version)||!Number.isSafeInteger(version.revision))throw new Error("发布版本响应无效");outbox={hash,batchId:`mac_${crypto.randomUUID()}`,baseRevision:version.revision,items:chunk};await atomicJson(outboxPath,outbox)}
  try{await publisherRequest({action:"publish",batchId:outbox.batchId,baseRevision:outbox.baseRevision,items:outbox.items})}catch(error:any){if(error.statusCode===409)await atomicJson(outboxPath,null);throw error}
  for(const item of chunk)ledger[`${item.kind}:${item.key}`]=JSON.stringify(item)
  await atomicJson(ledgerPath,ledger);await atomicJson(outboxPath,null);published+=chunk.length
}
// Force a consistent refresh on the next cycle, including any concurrent publisher's records.
await atomicJson(path,{...result,remoteRevision:undefined})
await publisherRequest({action:"maintain"})
console.log(JSON.stringify({published,storage:"D1",codeDeployment:false}))
