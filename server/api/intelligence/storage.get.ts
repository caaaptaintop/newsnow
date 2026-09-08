import { intelligenceStoragePolicy } from "@shared/intelligence-storage"
import { intelligenceSnapshot } from "@shared/intelligence-snapshot"
import { getIntelligenceStore } from "../../utils/intelligence-store"

/** Metadata diagnostics only; does not refresh sources, run AI, or fetch files. */
export default defineEventHandler(async () => {
  const store = await getIntelligenceStore()
  const snapshotAvailable = intelligenceSnapshot.generatedAt > 0 && intelligenceSnapshot.articles.length > 0
  return {
    policy: intelligenceStoragePolicy,
    runtimeDatabase: { available: store.persistent, schemaVersion: store.persistent ? store.schemaVersion : null, message: store.initializationError },
    durableStorage: store.persistent ? (snapshotAvailable ? "database_and_snapshot" : "database") : snapshotAvailable ? "repository_snapshot" : "none",
    repositorySnapshot: { available: snapshotAvailable, generatedAt: intelligenceSnapshot.generatedAt, articleCount: intelligenceSnapshot.articles.length },
    migration: await store.migrationStatus(),
    note: "正文可能为当次 AI 分析临时读取，但不持久保存。附件仅保存名称和原链接；未启用 R2。",
  }
})
