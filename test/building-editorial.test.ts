import { expect, it, vi } from "vitest"
import { intelligenceTopics } from "../shared/intelligence"
import { intelligenceClassify, intelligenceNormalizeDecision } from "../server/utils/intelligence-ai"
import { screenBuildingTitles } from "../tools/ai-bridge/title-screen"

it("offers only six specialist columns and rejects retired or invented categories", () => {
  expect(Object.keys(intelligenceTopics.building.categories)).toHaveLength(6)
  const base = { key: "a", keep: true, contentType: "会议活动", importance: 80, summary: "智能建造会议", relatedCategories: [], tags: [] }
  for (const category of ["policy", "construction_news", "news"]) expect(intelligenceNormalizeDecision({ ...base, category }, new Set(["a"]), "building")).toBeUndefined()
  expect(intelligenceNormalizeDecision({ ...base, category: "intelligent_construction" }, new Set(["a"]), "building")?.keep).toBe(true)
})
it("screens news and activities and assigns them by specialist subject", async () => {
  const run = vi.fn().mockResolvedValue({ items: [{ key: "item-1", keep: true, category: "intelligent_construction", relatedCategories: [], tags: [], contentType: "会议活动", importance: 80, summary: "召开智能建造交流会", reason: "施工智能化经验交流" }] })
  const items = [{ key: "a", title: "智能建造经验交流会召开", column: "建设要闻" }]
  await screenBuildingTitles({ model: "test", run }, items)
  expect(run.mock.calls[0][1].messages[0].content).toContain("不按文种排除")
  const result = await intelligenceClassify({ model: "test", run }, "building", items.map(item => ({ ...item, key: "item-1" })))
  expect(result.get("item-1")?.category).toBe("intelligent_construction")
  expect(run.mock.calls[1][1].messages[0].content).toContain("智能建造会议归智能建造")
})
