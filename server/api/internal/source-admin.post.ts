import { createError, defineEventHandler, getHeader, readBody } from "h3"
import { buildingDB } from "../../building/store"
import { requireSourceAdmin } from "../../source-admin/access"
import { publishSourceDraft, restoreSourceHistory, saveSourceDraft } from "../../source-admin/store"
import { discoverSourceEndpoints, testSourceConfiguration } from "../../source-admin/test-source"

export default defineEventHandler(async (event) => {
  if (!/^application\/json(?:;|$)/i.test(getHeader(event, "content-type") || "")) throw createError({ statusCode: 415, message: "只接受JSON请求" })
  const { actor } = await requireSourceAdmin(event)
  const body = await readBody(event)
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.action !== "string") throw createError({ statusCode: 400, message: "管理操作无效" })
  const db = buildingDB(event)
  switch (body.action) {
    case "save-draft": return saveSourceDraft(db, actor, body)
    case "publish": return publishSourceDraft(db, actor, body)
    case "restore-history": return restoreSourceHistory(db, actor, body)
    case "discover": return { candidates: await discoverSourceEndpoints(body.config) }
    case "test": return testSourceConfiguration(body.config, typeof body.endpointId === "string" ? body.endpointId : undefined)
    default: throw createError({ statusCode: 400, message: "不支持的管理操作" })
  }
})
