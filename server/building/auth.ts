import { getHeader,getRequestURL,getRequestWebStream } from "h3"
import registry from "../../shared/building-publisher-keys.json"
import { buildingHash,buildingLimits,BuildingError } from "../../shared/building-contract"
import { buildingEnv } from "./store"
function equal(a:string,b:string){if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0}
export async function machineRequest(event:any){
  const origin=getHeader(event,"origin"),url=getRequestURL(event)
  if(origin&&origin!==url.origin)throw new BuildingError(403,"不允许跨站发布")
  const env=buildingEnv(event),bearer=getHeader(event,"authorization")?.replace(/^Bearer /,"")??""
  const deadline=Number(env.BUILDING_DEPLOY_EXPIRES)
  const deployment=Number.isSafeInteger(deadline)&&deadline>Date.now()&&deadline<=Date.now()+1800000&&typeof env.BUILDING_DEPLOY_TOKEN==="string"&&/^[a-f0-9]{64}$/.test(env.BUILDING_DEPLOY_TOKEN)&&equal(bearer,env.BUILDING_DEPLOY_TOKEN)
  const key=(registry.keys as Array<{id:string,jwk:{kty:string,crv:string,x:string,ext?:boolean},capabilities:string[]}>).find(k=>k.id===getHeader(event,"x-building-key"))
  if(!deployment&&!key)throw new BuildingError(401,"缺少有效后台凭据")
  if(!/^application\/json(?:;|$)/i.test(getHeader(event,"content-type")??""))throw new BuildingError(415,"只接受JSON请求")
  const stream=getRequestWebStream(event);if(!stream)throw new BuildingError(400,"缺少请求内容")
  const reader=stream.getReader(),chunks:Uint8Array[]=[];let length=0
  try{while(true){const r=await reader.read();if(r.done)break;length+=r.value.byteLength;if(length>buildingLimits.requestBytes){await reader.cancel();throw new BuildingError(413,"请求过大")};chunks.push(r.value)}}finally{reader.releaseLock()}
  const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  let raw:string,body:any
  try{raw=new TextDecoder("utf-8",{fatal:true}).decode(bytes);body=JSON.parse(raw)}catch{throw new BuildingError(400,"JSON请求无效")}
  if(!body||typeof body!=="object"||Array.isArray(body)||typeof body.action!=="string")throw new BuildingError(400,"后台操作无效")
  if(deployment)return{owner:"deployment",body,capabilities:["publish","operate","migrate"]}
  const time=getHeader(event,"x-building-time")??"",signature=getHeader(event,"x-building-signature")??""
  if(!/^\d{13}$/.test(time)||Math.abs(Date.now()-Number(time))>300000||!/^[A-Za-z0-9+/=]{80,100}$/.test(signature))throw new BuildingError(401,"发布签名无效或已过期")
  try{
    const publicKey=await crypto.subtle.importKey("jwk",key!.jwk,{name:"Ed25519"},false,["verify"])
    const message=`${event.method}\n${url.pathname}\n${time}\n${await buildingHash(raw)}`
    if(!await crypto.subtle.verify("Ed25519",publicKey,Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),new TextEncoder().encode(message)))throw new Error()
  }catch{throw new BuildingError(401,"发布签名验证失败")}
  return{owner:key!.id,body,capabilities:key!.capabilities}
}
