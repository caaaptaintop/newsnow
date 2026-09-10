import { createError, defineEventHandler, getQuery, setHeader } from "h3"
import { requireSourceAdmin } from "../../../utils/source-admin-auth"
import { sourceAdminModel } from "../../../utils/source-config-store"

export default defineEventHandler(async (event) => {
  await requireSourceAdmin(event)
  setHeader(event, "cache-control", "no-store")
  const topic = String(getQuery(event).topic ?? "building")
  if (!["building", "ai", "finance", "health"].includes(topic)) throw createError({ statusCode: 400, statusMessage: "Invalid topic" })
  return sourceAdminModel(event, topic)
})
