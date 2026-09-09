import { createHmac,randomBytes } from "node:crypto"
import { readFile,writeFile,unlink } from "node:fs/promises"
import { execFileSync } from "node:child_process"
const token=process.env.CLOUDFLARE_API_TOKEN,account=process.env.CLOUDFLARE_ACCOUNT_ID,project="capx-newsnow",production="https://news.capx-ai.com"
if(!token||!account)throw new Error("Cloudflare deployment credentials missing")
const root=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/pages/projects/${project}`
async function api(path="",method="GET",body){
 const r=await fetch(root+path,{method,headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)})
 const j=await r.json();if(!r.ok||!j.success)throw new Error(`Cloudflare ${method} ${path||"project"}: HTTP ${r.status}; codes ${(j.errors??[]).map(e=>e.code).join(",")}`);return j.result
}
const cfg=await api(),prod=cfg.deployment_configs.production,preview=cfg.deployment_configs.preview??{}
const database=prod?.d1_databases?.NEWSNOW_DB?.id
if(!database)throw new Error("Existing NEWSNOW_DB production binding missing; no database will be created automatically")
const deployToken=randomBytes(32).toString("hex"),rateSalt=createHmac("sha256",token).update(`building-relay-v3:${account}`).digest("hex")
const safe=text=>String(text).split(deployToken).join("[redacted]").split(rateSalt).join("[redacted]").split(token).join("[redacted]")
const run=(bin,args,extra={})=>{
 try{const out=execFileSync(bin,args,{encoding:"utf8",maxBuffer:16*1024*1024,env:{...process.env,...extra}});console.log(safe(out));return out}
 catch(error){console.error(safe(error.stdout??""));console.error(safe(error.stderr??""));throw new Error(`Release command failed: ${bin} ${args[0]}`)}
}
const capture={articles:[]};let cursor=""
do{
 const response=await fetch(`${production}/api/intelligence?topic=building${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`,{signal:AbortSignal.timeout(60000)})
 if(!response.ok)throw new Error(`Cannot preserve current production metadata: HTTP ${response.status}`)
 const page=await response.json();if(!Array.isArray(page.articles))throw new Error("Production capture invalid")
 capture.articles.push(...page.articles);cursor=page.nextCursor??""
}while(cursor)
await writeFile("/tmp/building-release-capture.json",JSON.stringify(capture),{mode:0o600})
let previewDeployment
try{
 // Preserve all unrelated settings. Deployment-only bearer is scoped to this trusted preview.
 await api("","PATCH",{deployment_configs:{preview:{env_vars:{BUILDING_DEPLOY_TOKEN:{type:"secret_text",value:deployToken},BUILDING_RATE_SALT:{type:"secret_text",value:rateSalt}},d1_databases:{...(preview.d1_databases??{}),NEWSNOW_DB:{id:database}}},production:{env_vars:{BUILDING_RATE_SALT:{type:"secret_text",value:rateSalt}}}}})
 run("python",["-c",`import json,tomllib\nfrom pathlib import Path\np=Path('wrangler.toml')\nc=tomllib.loads(p.read_text())\nc['pages_build_output_dir']='dist/output/public'\nprod=c.get('env',{}).get('production',{})\ndb=prod.get('d1_databases',c.get('d1_databases',[]))\nassert any(d.get('binding')=='NEWSNOW_DB' and d.get('database_id') for d in db),'D1 config missing'\nc.setdefault('env',{}).setdefault('preview',{})['d1_databases']=db\nPath('wrangler.jsonc').write_text(json.dumps(c))\np.unlink()`])
 const branch=`building-release-${process.env.GITHUB_SHA.slice(0,12)}`
 const output=run("pnpm",["dlx",`wrangler@${process.env.WRANGLER_VERSION??"4.129.0"}`,"pages","deploy","dist/output/public","--branch",branch])
 const urls=[...output.matchAll(/https:\/\/[a-z0-9-]+\.capx-newsnow\.pages\.dev/g)].map(m=>m[0])
 if(!urls.length)throw new Error("Trusted preview URL missing")
 const releases=await api("/deployments"),match=releases.find(d=>d.url===urls[0]||urls.includes(d.url))
 if(!match?.id)throw new Error("Cannot verify created preview deployment identity")
 previewDeployment=match.id
 const base=match.url
 run("pnpm",["exec","tsx","scripts/migrate-building.ts"],{BUILDING_RELEASE_URL:base,BUILDING_RELEASE_TOKEN:deployToken,BUILDING_CAPTURE_PATH:"/tmp/building-release-capture.json"})
 run("node",["scripts/building-production-smoke.mjs"],{BUILDING_SMOKE_URL:base})
 // The alias changes only after D1 migration and preview checks have completed.
 run("pnpm",["dlx",`wrangler@${process.env.WRANGLER_VERSION??"4.129.0"}`,"pages","deploy","dist/output/public","--branch","main"])
 run("node",["scripts/building-production-smoke.mjs"])
 console.log(JSON.stringify({release:"pass",storage:"D1",previewValidated:true,codeIncludesProductionSnapshot:false}))
}finally{
 // Explicit null removes only the temporary bindings/vars created for this release.
 const oldVars=preview.env_vars??{},oldD1=preview.d1_databases??{}
 await api("","PATCH",{deployment_configs:{preview:{env_vars:{...oldVars,BUILDING_DEPLOY_TOKEN:oldVars.BUILDING_DEPLOY_TOKEN??null,BUILDING_RATE_SALT:oldVars.BUILDING_RATE_SALT??null},d1_databases:{...oldD1,NEWSNOW_DB:oldD1.NEWSNOW_DB??null}}}}).catch(error=>console.error(safe(error.message)))
 if(previewDeployment)await api(`/deployments/${previewDeployment}?force=true`,"DELETE").catch(error=>console.error(safe(error.message)))
 await unlink("/tmp/building-release-capture.json").catch(()=>{})
}
