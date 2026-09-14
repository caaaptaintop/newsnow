import { expect, it } from "vitest"
import type { IntelligenceSource } from "../shared/intelligence"
import { assertCollectionColumns, collectionColumns, collectionItemAllowed, collectionSourceAllowed } from "../tools/ai-bridge/collection-scope"

const source = { id: "official-mohurd", columns: [...collectionColumns].map(([name, url]) => ({ name, url })) } as IntelligenceSource
it("allows only the four verified ministry columns", () => {
  expect(() => assertCollectionColumns(source)).not.toThrow()
  expect(collectionSourceAllowed("official-shanghai")).toBe(false)
  expect(collectionItemAllowed({ sourceId: source.id, column: "建设要闻" })).toBe(true)
  expect(collectionItemAllowed({ sourceId: source.id, column: "其他栏目" })).toBe(false)
  expect(collectionItemAllowed({ sourceId: "official-shanghai", column: "建设要闻" })).toBe(false)
})
it("stops on missing, added, duplicate or changed columns before collection", () => {
  for (const columns of [[], source.columns!.slice(1), [...source.columns!, source.columns![0]], source.columns!.map(() => source.columns![0]), source.columns!.map(c => ({ ...c, url: `${c.url}?changed=1` }))]) {
    expect(() => assertCollectionColumns({ ...source, columns })).toThrow("住建部四栏目")
  }
  expect(() => assertCollectionColumns({ ...source, id: "official-shanghai" })).toThrow()
})
