import type { IntelligenceArticle, IntelligenceSource, IntelligenceTopic } from "./intelligence"

export type PublicIntelligenceArticle = Omit<IntelligenceArticle, "model" | "analysisVersion">
export type PublicIntelligenceSource = Pick<IntelligenceSource, "id" | "name" | "home" | "group" | "region" | "city">
export interface PublicIntelligenceFeed {
  topic: IntelligenceTopic
  version: string
  updatedAt?: number
  articles: PublicIntelligenceArticle[]
  sources: PublicIntelligenceSource[]
  truncated: boolean
}
