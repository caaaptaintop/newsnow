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

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose"
import { beforeAll } from "vitest"
import { verifySourceAdminToken } from "../server/utils/source-admin-auth"

describe("actual Access JWT verification", () => {
  const audience = "a".repeat(64), team = "synthetic.cloudflareaccess.com", email = "owner@example.com"
  let keys: Awaited<ReturnType<typeof generateKeyPair>>
  let verifyKey: ReturnType<typeof createLocalJWKSet>
  beforeAll(async () => {
    keys = await generateKeyPair("RS256")
    verifyKey = createLocalJWKSet({ keys: [{ ...await exportJWK(keys.publicKey), kid: "synthetic", alg: "RS256" }] })
  })
  const config = { team, audience, allowed: new Set([email]) }
  async function token(overrides: Record<string, unknown> = {}, alternate = false) {
    const now = Math.floor(Date.now() / 1000)
    const signing = alternate ? (await generateKeyPair("RS256")).privateKey : keys.privateKey
    return new SignJWT({ iss: `https://${team}`, sub: "synthetic-owner", aud: [audience], iat: now, exp: now + 600, type: "app", email, ...overrides })
      .setProtectedHeader({ alg: "RS256", kid: "synthetic" }).sign(signing)
  }
  it("verifies a cryptographically signed allowed principal", async () => {
    await expect(verifySourceAdminToken(await token(), config, verifyKey)).resolves.toEqual({ email })
  })
  it.each([
    { aud: "other-app" }, { iss: "https://other.cloudflareaccess.com" }, { email: "stranger@example.com" },
    { email: undefined }, { exp: 1 }, { exp: undefined }, { iat: undefined }, { sub: undefined },
    { iat: Math.floor(Date.now() / 1000) + 3600 }, { nbf: Math.floor(Date.now() / 1000) + 3600 }, { type: "org" },
  ])("rejects invalid verified claims %s", async (claims) => {
    await expect(verifySourceAdminToken(await token(claims), config, verifyKey)).rejects.toThrow()
  })
  it("rejects a forged signature rather than decoding its email", async () => {
    await expect(verifySourceAdminToken(await token({}, true), config, verifyKey)).rejects.toThrow()
  })
  it("rejects malformed allowlist entries instead of accepting arbitrary tokens", () => {
    expect(sourceAdminAllowedEmails("owner@example.com, not-an-email").size).toBe(0)
  })
})
