import { createHash,generateKeyPairSync,createPrivateKey,createPublicKey,sign } from "node:crypto"
import { chmod,mkdir,readFile,rename,writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
export const publisherRoot=resolve(import.meta.dirname,"../..")
const directory=resolve(publisherRoot,".data/building-publisher"),privatePath=resolve(directory,"private-key.pem")
export async function publisherRequest(body,{base=process.env.BUILDING_SITE_URL??"https://news.capx-ai.com",fetcher=fetch}={}){
  const url=new URL("/api/internal/building",base)
  if(url.protocol!=="https:"&&!["localhost","127.0.0.1"].includes(url.hostname))throw new Error("Publisher requires HTTPS")
  const privateKey=createPrivateKey(await readFile(privatePath,"utf8")),jwk=createPublicKey(privateKey).export({format:"jwk"})
  const id=`mac-${createHash("sha256").update(jwk.x).digest("hex").slice(0,20)}`,raw=JSON.stringify(body),time=String(Date.now())
  const message=`POST\n${url.pathname}\n${time}\n${createHash("sha256").update(raw).digest("hex")}`
  let response
  try{response=await fetcher(url,{method:"POST",headers:{"Content-Type":"application/json","X-Building-Key":id,"X-Building-Time":time,"X-Building-Signature":sign(null,Buffer.from(message),privateKey).toString("base64")},body:raw,signal:AbortSignal.timeout(60000),redirect:"error"})}catch{throw new Error("发布网络不可用；保留待发布结果，下轮重试")}
  if(!response.ok){const error=new Error(`发布接口返回HTTP ${response.status}；请检查公钥部署或批次状态`);error.statusCode=response.status;throw error}
  return response.json()
}
export async function atomicJson(path,data){await writeFile(`${path}.pending`,JSON.stringify(data)+"\n",{mode:0o600});await rename(`${path}.pending`,path)}
export async function preparePublisher(){
  await mkdir(directory,{recursive:true,mode:0o700})
  let pem
  try{pem=await readFile(privatePath,"utf8")}catch(error){if(error.code!=="ENOENT")throw error;pem=generateKeyPairSync("ed25519").privateKey.export({type:"pkcs8",format:"pem"});await writeFile(privatePath,pem,{flag:"wx",mode:0o600})}
  await chmod(privatePath,0o600)
  const jwk=createPublicKey(createPrivateKey(pem)).export({format:"jwk"}),id=`mac-${createHash("sha256").update(jwk.x).digest("hex").slice(0,20)}`
  const registryPath=resolve(publisherRoot,"shared/building-publisher-keys.json"),marker=resolve(directory,"registered.json")
  const registry=JSON.parse(await readFile(registryPath,"utf8"))
  const git=args=>execFileSync("git",args,{cwd:publisherRoot,encoding:"utf8",env:{...process.env,GIT_TERMINAL_PROMPT:"0",SKIP_SIMPLE_GIT_HOOKS:"1"}}).trim()
  if(!registry.keys.some(k=>k.id===id)){
    try{await readFile(marker);throw new Error("本机公钥已被移除；已停止自动注册，请由维护者确认后重新登记")}catch(error){if(error.code!=="ENOENT")throw error}
    if(git(["branch","--show-current"])!=="main"||git(["status","--porcelain"]))throw new Error("登记公钥需要干净的main工作副本")
    registry.keys.push({id,jwk,capabilities:["publish","operate"]})
    // One configuration commit, containing only public verification material.
    await writeFile(registryPath,JSON.stringify(registry,null,2)+"\n")
    git(["add","shared/building-publisher-keys.json"])
    git(["-c","core.hooksPath=/dev/null","commit","-m","chore: register local building publisher public key"])
  }
  await atomicJson(marker,{id})
  // A no-op push does not deploy anything; recovers a registration push lost to network failure.
  git(["push","origin","main"])
  let version
  try{version=await publisherRequest({action:"version"})}catch(error){if(error.statusCode===401)throw new Error("公钥等待部署；下一轮自动重试，本轮不调用AI");throw error}
  if(!version.migrationComplete)throw new Error("数据库迁移尚未完成，本轮不调用AI")
  const dir=resolve(publisherRoot,".data/mac-batch"),path=resolve(dir,"published.json")
  await mkdir(dir,{recursive:true})
  let existing
  try{existing=JSON.parse(await readFile(path,"utf8"))}catch(error){if(error.code!=="ENOENT")throw error}
  if(existing?.remoteRevision===version.revision)return{ready:true,keyId:id,revision:version.revision}
  let after="";const articles=[]
  do{const page=await publisherRequest({action:"export",after,revision:version.revision});articles.push(...page.articles);after=page.after}while(after)
  await atomicJson(path,{pipeline:"mac",generatedAt:version.published_at,remoteRevision:version.revision,articles,states:[],seen:{}})
  return{ready:true,keyId:id,revision:version.revision,articles:articles.length}
}
export async function publisherKnown(keys){const records=[];for(let i=0;i<keys.length;i+=80){const r=await publisherRequest({action:"known",keys:keys.slice(i,i+80)});records.push(...r.records)}return records}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{const action=process.argv[2]??"status";const result=action==="prepare"?await preparePublisher():action==="pause-relay"?await publisherRequest({action:"relay",enabled:false}):action==="resume-relay"?await publisherRequest({action:"relay",enabled:true}):action==="maintain"?await publisherRequest({action:"maintain"}):await publisherRequest({action:"status"});console.log(JSON.stringify(result,null,2))}catch(error){console.error(error.message);process.exitCode=1}
}
