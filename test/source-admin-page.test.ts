import { Script } from "node:vm"
import { describe, expect, it } from "vitest"
import { sourceAdminPage } from "../server/source-admin/page"

describe("source administration page", () => {
  it("renders topic navigation and separate health states without raw email HTML", () => {
    const html = sourceAdminPage("owner+<test>@example.com")
    expect(html).toContain("信息源管理中心")
    expect(html).toContain("配置状态")
    expect(html).toContain("运行状态")
    expect(html).toContain("建筑")
    expect(html).toContain("健康")
    expect(html).toContain("owner+&lt;test&gt;@example.com")
    expect(html).not.toContain("owner+<test>@example.com")
  })

  it("keeps configured endpoint drafts in explicit mode and preserves save feedback", () => {
    const html = sourceAdminPage("owner@example.com")
    expect(html).toContain("hasConfiguredEndpoint")
    expect(html).toContain("已自动切换为“明确栏目”")
    expect(html).toContain("已填写栏目，请先使用“明确栏目”模式再测试")
    expect(html).toContain("草稿已保存；当前草稿尚未测试。测试通过后才能启用采集。")
    expect(html).toContain("el('f-mode').value='explicit';bindRemoves();markDirty()")
  })

  it("emits a syntactically valid browser script", () => {
    const html = sourceAdminPage("owner@example.com", "preview")
    const script = html.match(/<script nonce="preview">([\s\S]*?)<\/script>/)?.[1]
    expect(script).toBeTruthy()
    expect(() => new Script(script!)).not.toThrow()
  })
})
