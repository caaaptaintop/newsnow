import { open, rename } from "node:fs/promises"
import { dirname } from "node:path"

/** Prioritize recent entries across columns without discarding the backlog. */
export function prioritizeCandidates<T extends { publishedAt?: number }>(items: readonly T[]): T[] {
  const date = (item: T) => Number.isFinite(item.publishedAt) && item.publishedAt! > 0 ? item.publishedAt! : 0
  return [...items].sort((a, b) => date(b) - date(a))
}

/** Store list metadata only; title screening is never a publication decision. */
export function queuedCandidate(item: any, sourceId: string, screened = false) {
  return { key: item.key, sourceId, title: item.title, url: item.url, column: item.column ?? "", publishedAt: item.publishedAt, titleScreened: screened, ...(item.collectionScope ? { collectionScope: item.collectionScope } : {}) }
}
export async function saveBatchResult(path: string, value: unknown) {
  const temporary = `${path}.pending`
  const file = await open(temporary, "w", 0o600)
  try {
    await file.writeFile(`${JSON.stringify(value)}\n`)
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(temporary, path)
  const directory = await open(dirname(path), "r")
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}
