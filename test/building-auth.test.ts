import { beforeEach,describe,it,expect,vi } from "vitest"
import { createHash,generateKeyPairSync,sign } from "node:crypto"
import { machineRequest } from "../server/building/auth"
import registry from "../shared/building-publisher-keys.json"
vi.mock("../shared/building-publisher-keys.json",()=>({default:{keys:[]}}))
vi.mock("h3",()=>({getHeader:(e:any,n:string)=>e.headers[n],getRequestURL:()=>new URL("https://news.example.com/api/internal/building"),getRequestWebStream:(e:any)=>new Response(e.body).body}))
const pair=generateKeyPairSync("ed25519"),jwk=pair.publicKey.export({format:"jwk"}),keys=registry.keys as any[]
beforeEach(()=>{keys.splice(0);keys.push({id:"test-key",jwk,capabilities:["publish"]})})
function event(action="known",extra:any={}){
 const body=JSON.stringify({action,keys:[]}),time=String(Date.now()),signature=sign(null,Buffer.from(`POST\n/api/internal/building\n${time}\n${createHash("sha256").update(body).digest("hex")}`),pair.privateKey).toString("base64")
 return{method:"POST",body,context:{},headers:{"content-type":"application/json","x-building-key":"test-key","x-building-time":time,"x-building-signature":signature},...extra}
}
describe("machine authentication without visitor accounts",()=>{
 it("requires an unexpired bounded deployment credential",async()=>{
  const e=event("init");e.headers={"content-type":"application/json",authorization:`Bearer ${"a".repeat(64)}`} as any
  e.context={env:{BUILDING_DEPLOY_TOKEN:"a".repeat(64),BUILDING_DEPLOY_EXPIRES:String(Date.now()+600000)}}
  const authenticated=await machineRequest(e)
  expect(authenticated.capabilities).toContain("migrate")
  expect(authenticated.capabilities).not.toContain("runtime-source-test")
  for(const deadline of [undefined,String(Date.now()-1),String(Date.now()+3600000)]){
    e.context={env:{BUILDING_DEPLOY_TOKEN:"a".repeat(64),BUILDING_DEPLOY_EXPIRES:deadline}}
    await expect(machineRequest(e)).rejects.toMatchObject({statusCode:401})
  }
 })
 it("accepts a valid body-bound signature and preserves capabilities",async()=>{const r=await machineRequest(event());expect(r.owner).toBe("test-key");expect(r.capabilities).toEqual(["publish"])})
 it("preserves the dedicated runtime source-test capability for registered signed machines",async()=>{
  keys[0].capabilities.push("runtime-source-test")
  const r=await machineRequest(event("source-tests"))
  expect(r.owner).toBe("test-key")
  expect(r.capabilities).toContain("runtime-source-test")
 })
 it("rejects unsigned, tampered, expired and revoked credentials",async()=>{
  await expect(machineRequest(event("known",{headers:{}}))).rejects.toMatchObject({statusCode:401})
  const changed=event();changed.body=JSON.stringify({action:"relay",enabled:false});await expect(machineRequest(changed)).rejects.toMatchObject({statusCode:401})
  const expired=event();expired.headers["x-building-time"]=String(Date.now()-600000);await expect(machineRequest(expired)).rejects.toMatchObject({statusCode:401})
  keys.splice(0);await expect(machineRequest(event())).rejects.toMatchObject({statusCode:401})
 })
 it("does not accept deployment bearer when the environment secret is absent",async()=>{
  const e=event("init");e.headers={authorization:`Bearer ${"a".repeat(64)}`} as any
  await expect(machineRequest(e)).rejects.toMatchObject({statusCode:401})
 })
 it("rejects oversized and cross-origin requests",async()=>{
  const e=event();e.body="x".repeat(600000);await expect(machineRequest(e)).rejects.toMatchObject({statusCode:413})
  const cross=event();(cross.headers as any).origin="https://evil.example";await expect(machineRequest(cross)).rejects.toMatchObject({statusCode:403})
 })
})
