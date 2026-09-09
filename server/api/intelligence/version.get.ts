import { createError,defineEventHandler,getRequestURL,setHeaders } from "h3"
import { publicSite,isPublishedTopic } from "@shared/public-site"
import { BuildingError } from "@shared/building-contract"
import { currentBuildingVersion } from "../../building/cache"
export default defineEventHandler(async event=>{
  setHeaders(event,{"Cache-Control":"private, no-store","CDN-Cache-Control":"no-store","Cloudflare-CDN-Cache-Control":"no-store"})
  const topics=getRequestURL(event).searchParams.getAll("topic")
  if(topics.length>1)throw createError({statusCode:400,message:"只能选择一个主题"})
  if(!isPublishedTopic(topics[0]??publicSite.defaultTopic))throw createError({statusCode:404,message:"该主题暂未开放"})
  try{return await currentBuildingVersion(event)}catch(error){
    if(error instanceof BuildingError)throw createError({statusCode:error.statusCode,message:error.message})
    throw createError({statusCode:503,message:"资讯库暂不可用，请稍后重试"})
  }
})
