import type { IntelligenceArticle, IntelligenceSource, IntelligenceTopic } from "./intelligence"

export type PublicIntelligenceArticle = Omit<IntelligenceArticle, "model" | "analysisVersion">
export type PublicIntelligenceSource = Pick<IntelligenceSource, "id" | "name" | "home" | "group" | "region" | "city">
export interface PublicIntelligenceFeed {
  topic: IntelligenceTopic
  version: string
  updatedAt?: number
  articles: PublicIntelligenceArticle[]
  sources: PublicIntelligenceSource[]
  total?: number
  totalPublished?: number
  nextCursor?: string | null
  facets?: { categories: Record<string, number>, locations: { region: string, cities: string[] }[], tags: { id: string, name: string }[] }
  truncated: boolean
}
