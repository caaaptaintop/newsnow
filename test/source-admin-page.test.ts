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
})
