import { defineEventHandler, getQuery } from "h3"
import { buildingDB } from "../../building/store"
import { requireSourceAdmin } from "../../source-admin/access"
import { sourceAdminDashboard, sourceAdminDetail } from "../../source-admin/store"

export default defineEventHandler(async (event) => {
  await requireSourceAdmin(event)
  const query = getQuery(event)
  const sourceId = typeof query.sourceId === "string" ? query.sourceId : ""
  return sourceId ? sourceAdminDetail(buildingDB(event), sourceId) : sourceAdminDashboard(buildingDB(event))
})
