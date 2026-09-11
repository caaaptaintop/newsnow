import { defineEventHandler, setHeader } from "h3"
import { sourceConfigEnvelope } from "../../../../../shared/source-config"
import { publishedBuildingSourceOverrides } from "../../../../utils/source-config-store"

export default defineEventHandler(async (event) => {
  setHeader(event, "cache-control", "private, no-store")
  return sourceConfigEnvelope(await publishedBuildingSourceOverrides(event))
})
