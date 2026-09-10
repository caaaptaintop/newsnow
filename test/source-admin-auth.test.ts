import { describe, expect, it } from "vitest"
import { normalizeAccessTeamDomain, sourceAdminAllowedEmails } from "../server/utils/source-admin-auth"

describe("source admin access configuration", () => {
  it("normalizes only Cloudflare Access team domains", () => {
    expect(normalizeAccessTeamDomain("https://capx.cloudflareaccess.com/ ")).toBe("capx.cloudflareaccess.com")
    expect(normalizeAccessTeamDomain("example.com")).toBe("")
  })

  it("parses a strict email allowlist", () => {
    expect([...sourceAdminAllowedEmails("A@example.com, b@example.com\nc@example.com")]).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ])
  })
})
