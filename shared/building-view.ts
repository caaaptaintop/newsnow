import { emptyIntelligenceFilters, intelligenceTopics } from "./intelligence"
import { isPublishedTopic, publicSite } from "./public-site"

const categories: Record<string, string> = intelligenceTopics[publicSite.defaultTopic].categories

export function buildingView(search = "") {
  const params = new URLSearchParams(search)
  const topics = params.getAll("topic")
  const unavailable = topics.length > 1 || (topics.length === 1 && !isPublishedTopic(topics[0]))
  const filters = emptyIntelligenceFilters()
  const category = params.get("category") ?? ""
  if (Object.prototype.hasOwnProperty.call(categories, category)) filters.category = category
  filters.q = (params.get("q") ?? "").slice(0, 200)
  for (const key of ["regions", "cities", "types", "sources"] as const) filters[key] = [...new Set(params.getAll(key).filter(value => value.length > 0 && value.length <= 200))].slice(0, 30)
  const days = Number(params.get("days"))
  if ([7, 30, 90, 365].includes(days)) filters.days = days
  const importance = Number(params.get("importance"))
  if ([60, 80].includes(importance)) filters.importance = importance
  const sort = params.get("sort")
  if (sort === "recommended" || sort === "importance") filters.sort = sort
  return { filters, unavailable }
}
