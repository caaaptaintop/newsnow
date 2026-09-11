import { createError,defineEventHandler,setHeaders } from "h3"
import { machineRequest } from "../../building/auth"
import { buildingDB,buildingMeta,initializeBuilding,publishBatch,knownRecords,activateBuilding } from "../../building/store"
import { buildingStatus,relayPolicy,maintainBuilding } from "../../building/relay-budget"
import { BuildingError } from "@shared/building-contract"
import { pendingRuntimeSourceTests, saveRuntimeSourceTest } from "../../source-admin/runtime-source-test"
export default defineEventHandler(async event=>{
  setHeaders(event,{"Cache-Control":"private, no-store","CDN-Cache-Control":"no-store"})
  try{
    const {owner,body,capabilities}=await machineRequest(event)
    const operations:Record<string,string>={init:"migrate",legacy:"migrate",activate:"migrate",publish:"publish",known:"publish",export:"publish",version:"publish",status:"operate",relay:"operate",maintain:"operate","source-tests":"operate","source-test-result":"operate"}
    if(!Object.prototype.hasOwnProperty.call(operations,body.action))throw new BuildingError(404,"后台操作不存在")
    if(!capabilities.includes(operations[body.action]))throw new BuildingError(403,"后台凭据不具备此操作权限")
    const db=buildingDB(event)
    switch(body.action){
      case "init":return initializeBuilding(db)
      case "version":return buildingMeta(db)
      case "publish":return publishBatch(db,owner,body)
      case "known":return knownRecords(db,body.keys)
      case "export":{
        if(typeof body.after!=="string"||body.after.length>200)throw new BuildingError(400,"导出位置无效")
        const rows=await db.batch([db.prepare("SELECT * FROM building_meta_v3 WHERE topic='building'"),db.prepare("SELECT id,data FROM building_docs_v3 WHERE id>? ORDER BY id LIMIT 80").bind(body.after)])
        if(body.revision!=null&&rows[0].results[0].revision!==body.revision)throw new BuildingError(409,"导出期间资讯已更新，请重新读取")
        const articles=rows[1].results
        return{revision:rows[0].results[0].revision,articles:articles.map((r:any)=>JSON.parse(r.data)),after:articles.length===80?articles[79].id:null}
      }
      case "legacy":{
        if(typeof body.after!=="string"||body.after.length>200||!["v1","v2"].includes(body.table))throw new BuildingError(400,"迁移参数无效")
        const name=body.table==="v1"?"intelligence_documents_v1":"intelligence_feed_v2"
        const exists=await db.prepare("SELECT name FROM sqlite_master WHERE name=?").bind(name).first()
        if(!exists)return{articles:[],after:null}
        const rows=(await db.prepare(`SELECT id,data FROM ${name} WHERE topic='building' AND id>? ORDER BY id LIMIT 80`).bind(body.after).all<any>()).results
        return{articles:rows.map(r=>{try{return JSON.parse(r.data)}catch{throw new BuildingError(409,"旧数据JSON损坏，迁移已停止")}}),after:rows.length===80?rows[79].id:null}
      }
      case "activate":return activateBuilding(db,body.expectedTotal,body.revision)
      case "status":return buildingStatus(db)
      case "relay":return relayPolicy(db,body)
      case "maintain":await maintainBuilding(db);return{ok:true}
      case "source-tests":return pendingRuntimeSourceTests(event, Number(body.limit ?? 1))
      case "source-test-result":return saveRuntimeSourceTest(event, owner, body)
    }
  }catch(error){
    if(error instanceof BuildingError)throw createError({statusCode:error.statusCode,message:error.message})
    if(error && typeof error === "object" && "statusCode" in error && Number.isInteger(Number((error as any).statusCode)))
      throw createError({statusCode:Number((error as any).statusCode),message:String((error as any).message ?? "后台操作未完成")})
    throw createError({statusCode:503,message:"后台操作未完成，请稍后重试；未完成的批次不对外发布"})
  }
})
