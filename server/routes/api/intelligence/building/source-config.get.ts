import { defineEventHandler, setHeader } from "h3"
import { publishedBuildingSourceOverrides } from "../../../../utils/source-config-store"

export default defineEventHandler(async (event) => {
  setHeader(event, "cache-control", "no-store")
  const sources = await publishedBuildingSourceOverrides(event)
  return {
    schemaVersion: 1,
    topic: "building",
    revision: sources.length,
    generatedAt: Date.now(),
    sources,
  }
})
