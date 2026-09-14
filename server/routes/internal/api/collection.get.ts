import { defineEventHandler, setHeader } from "h3"
import { requireSourceAdmin } from "../../../utils/source-admin-auth"
import { collectionStatus } from "../../../source-admin/collection-jobs"

export default defineEventHandler(async (event) => {
  setHeader(event, "cache-control", "private, no-store")
  await requireSourceAdmin(event)
  return collectionStatus(event)
})
