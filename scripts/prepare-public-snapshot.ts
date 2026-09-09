import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"

// Build-only projection. Never overwrite the archival JSON input or delete history.
const root = resolve(import.meta.dirname, "..")
const result = { pipeline: "mac", generatedAt: 0, articles: [], states: [], seen: {} }
const types = `import type { IntelligenceArticle, IntelligenceSourceState } from "./intelligence"
export interface IntelligenceSnapshotSeen { key: string; at: number }
export interface IntelligenceSnapshot { pipeline?: "mac"; generatedAt: number; articles: IntelligenceArticle[]; states: IntelligenceSourceState[]; seen: Record<string, IntelligenceSnapshotSeen[]> }
`
await writeFile(resolve(root, "shared/intelligence-snapshot.ts"), `${types}
/** Build projection: only enabled topics. */
export const intelligenceSnapshot: IntelligenceSnapshot = ${JSON.stringify(result)}
`)
console.log(`Public build snapshot: ${result.articles.length} enabled-topic records`)
