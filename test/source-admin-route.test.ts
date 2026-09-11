import type { H3Event } from "h3"
import { describe, expect, it, vi } from "vitest"
import { requireSameOriginWrite, requireSourceAdmin } from "../server/utils/source-admin-auth"

function eventWithHeaders(headers: Record<string, string> = {}, env: Record<string, string> = {}) {
  const url = new URL("http://news.capx-ai.com/internal/api/sources")
  const requestHeaders = { host: url.host, ...headers }
  return {
    context: { env },
    url,
    req: new Request(url, { headers: requestHeaders }),
    node: { req: { url: `${url.pathname}${url.search}`, originalUrl: `${url.pathname}${url.search}`, headers: requestHeaders, socket: { encrypted: false } } },
  } as unknown as H3Event
}
describe("internal authentication fails closed", () => {
  it("denies requests before any database access when not configured", async () => {
    await expect(requireSourceAdmin(eventWithHeaders())).rejects.toMatchObject({ statusCode: 404 })
  })
  it("requires the Access assertion rather than an email header", async () => {
    const event = eventWithHeaders({ "cf-access-authenticated-user-email": "owner@example.com" }, {
      SOURCE_ADMIN_ACCESS_TEAM_DOMAIN: "synthetic.cloudflareaccess.com", SOURCE_ADMIN_ACCESS_AUD: "a".repeat(64), SOURCE_ADMIN_EMAILS: "owner@example.com",
    })
    await expect(requireSourceAdmin(event)).rejects.toMatchObject({ statusCode: 401 })
  })
  it("rejects oversize assertions without requesting remote keys", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No real network"))
    try {
      const event = eventWithHeaders({ "cf-access-jwt-assertion": "x".repeat(17000) }, {
        SOURCE_ADMIN_ACCESS_TEAM_DOMAIN: "synthetic.cloudflareaccess.com", SOURCE_ADMIN_ACCESS_AUD: "a".repeat(64), SOURCE_ADMIN_EMAILS: "owner@example.com",
      })
      await expect(requireSourceAdmin(event)).rejects.toMatchObject({ statusCode: 403 })
      expect(fetcher).not.toHaveBeenCalled()
    } finally { fetcher.mockRestore() }
  })
  it.each([{}, { origin: "https://evil.example.com" }, { origin: "http://news.capx-ai.com", "sec-fetch-site": "cross-site" }])("denies absent or cross-site origins %s", (headers) => {
    expect(() => requireSameOriginWrite(eventWithHeaders(headers))).toThrow()
  })
  it("permits the exact request origin", () => {
    expect(() => requireSameOriginWrite(eventWithHeaders({ origin: "http://news.capx-ai.com" }))).not.toThrow()
  })
})
