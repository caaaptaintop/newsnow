import { expect, it, vi } from "vitest"
import { screenBuildingTitles } from "../tools/ai-bridge/title-screen"

const items = [{ key: "a", title: "关于印发住宅项目规范的通知", column: "政策文件" }, { key: "b", title: "关于公开招聘工作人员的公告" }]
it("uses semantic title screening with uncertainty passed to body analysis", async () => {
  const run = vi.fn().mockResolvedValue({ items: [{ key: "item-2", keep: false, reason: "明确人事招聘" }, { key: "item-1", keep: true, reason: "住宅标准需要正文复核" }] })
  const result = await screenBuildingTitles({ model: "test", run }, items)
  expect(result.get("a")?.keep).toBe(true)
  expect(result.get("b")?.keep).toBe(false)
  const messages = run.mock.calls[0][1].messages
  expect(messages[0].content).toContain("不确定时keep=true")
  expect(JSON.parse(messages[1].content)[0]).toEqual({ key: "item-1", title: items[0].title, column: "政策文件" })
})
it("rejects missing, duplicate, unknown or malformed decisions", async () => {
  for (const rows of [[], [{ key: "item-1", keep: true, reason: "a" }], [{ key: "item-1", keep: true, reason: "a" }, { key: "item-1", keep: false, reason: "b" }], [{ key: "other", keep: false, reason: "b" }], [{ key: "item-1", keep: "false", reason: "b" }]]) {
    await expect(screenBuildingTitles({ model: "test", run: async () => ({ items: rows }) }, items)).rejects.toThrow(/标题初筛/)
  }
})
it("does not call AI for empty input or silently exceed the batch budget", async () => {
  const run = vi.fn()
  expect((await screenBuildingTitles({ model: "test", run }, [])).size).toBe(0)
  await expect(screenBuildingTitles({ model: "test", run }, Array.from({ length: 31 }, (_, i) => ({ key: String(i), title: "标题" })))).rejects.toThrow()
  expect(run).not.toHaveBeenCalled()
})
