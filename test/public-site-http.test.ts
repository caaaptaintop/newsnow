import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createServer, type Server } from "node:http"
import { createApp, defineEventHandler, toNodeListener } from "h3"
import gate from "../server/middleware/00-public-site"
let server: Server
let base: string
let calls = 0
beforeAll(async () => {
  const app = createApp()
  app.use(gate)
  app.use(defineEventHandler(() => { calls++; return { reachedHandler: true } }))
  server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) })
describe("public gate precedes every legacy handler", () => {
  it.each(["/api/login", "/api/oauth/github?code=attacker", "/api/me/sync", "/api/intelligence/ai/settings", "/api/intelligence/refresh", "/api/topics/health/classify", "/api/s", "/api/intelligence/storage", "/api/%74opics/health/status", "/api//intelligence", "/api/unknown"])('rejects %s without reaching a handler', async path => {
    const before = calls
    const response = await fetch(base + path)
    expect(response.status).toBe(404)
    expect(calls).toBe(before)
    expect(response.headers.get("cache-control")).toContain("no-store")
  })
  it.each(["health", "ai", "finance", "constructor", ""])('rejects topic %s on both public read routes', async topic => {
    const before = calls
    for (const path of ["/api/intelligence", "/api/intelligence/version"])
      expect((await fetch(`${base}${path}?topic=${topic}`)).status).toBe(404)
    expect(calls).toBe(before)
  })
  it("rejects duplicate topic values and unsupported read methods", async () => {
    const before = calls
    expect((await fetch(`${base}/api/intelligence?topic=building&topic=health`)).status).toBe(400)
    expect((await fetch(`${base}/api/intelligence`, { method: "POST", body: "{}" })).status).toBe(404)
    expect(calls).toBe(before)
  })
  it("allows anonymous building reads and exact indexed preview entry", async () => {
    expect((await fetch(`${base}/api/intelligence?topic=building`)).status).toBe(200)
    expect((await fetch(`${base}/api/intelligence/`)).status).toBe(200)
    expect((await fetch(`${base}/api/intelligence/version`)).status).toBe(200)
    expect((await fetch(`${base}/api/intelligence/attachment`, { method: "POST", body: "{}" })).status).toBe(200)
  })
})
