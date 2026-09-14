import { type Server, createServer } from "node:http"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { type H3Event, createApp, defineEventHandler, toNodeListener } from "h3"
import { claimCollection, collectionStatus, finishCollection, pollCollection, requestCollection } from "../server/source-admin/collection-jobs"
import buildingHandler from "../server/api/internal/building.post"
import * as machineAuth from "../server/building/auth"
import * as auth from "../server/utils/source-admin-auth"
import getCollection from "../server/routes/internal/api/collection.get"
import postCollection from "../server/routes/internal/api/collection.post"
import { memoryBuildingDB } from "./helpers/building-db"

function fixture() {
  const { db, sqlite } = memoryBuildingDB()
  return { event: { context: { env: { NEWSNOW_DB: db } } } as unknown as H3Event, sqlite }
}
describe("collection queue SQLite transactions", () => {
  it("read and poll never initialize schema", async () => {
    const { event, sqlite } = fixture()
    try {
      expect((await collectionStatus(event)).job).toBeNull()
      expect((await pollCollection(event)).job).toBeNull()
      expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([])
    } finally {
      sqlite.close()
    }
  })
  it("concurrent duplicate clicks and claims admit one active job and one execution", async () => {
    const { event, sqlite } = fixture()
    try {
      const requests = await Promise.all(Array.from({ length: 12 }, () => requestCollection(event, "admin@example.com")))
      const id = requests[0].job!.id
      expect(new Set(requests.map(result => result.job!.id)).size).toBe(1)
      const claims = await Promise.all(Array.from({ length: 12 }, (_, i) => claimCollection(event, `mac-${i}`, id)))
      expect(claims.filter(result => result.claimed)).toHaveLength(1)
      expect((await claimCollection(event, "mac-0", id)).claimed).toBe(false)
      expect((await requestCollection(event, "other@example.com")).job!.id).toBe(id)
      expect((await pollCollection(event)).job).toBeNull()
      expect(sqlite.prepare("SELECT count(*) AS count FROM building_collection_jobs").get()).toMatchObject({ count: 1 })
    } finally {
      sqlite.close()
    }
  })
  it("only claim owner finishes; same terminal result is idempotent even after new request", async () => {
    const { event, sqlite } = fixture()
    try {
      const id = (await requestCollection(event, "admin@example.com")).job!.id
      const result = { id, state: "complete", message: "采集完成" }
      await expect(finishCollection(event, "mac", result)).rejects.toMatchObject({ statusCode: 409 })
      await claimCollection(event, "mac", id)
      await expect(finishCollection(event, "other-mac", result)).rejects.toMatchObject({ statusCode: 409 })
      const finished = await finishCollection(event, "mac", result)
      expect((await requestCollection(event, "admin@example.com")).job!.id).not.toBe(id)
      expect(await finishCollection(event, "mac", result)).toEqual(finished)
      await expect(finishCollection(event, "mac", { ...result, state: "error" })).rejects.toMatchObject({ statusCode: 409 })
      await expect(finishCollection(event, "mac", { ...result, message: "changed" })).rejects.toMatchObject({ statusCode: 409 })
    } finally {
      sqlite.close()
    }
  })
  it("rejects invalid states and identifiers without changing running job", async () => {
    const { event, sqlite } = fixture()
    try {
      const id = (await requestCollection(event, "admin@example.com")).job!.id
      await expect(claimCollection(event, "deployment", id)).rejects.toMatchObject({ statusCode: 409 })
      await expect(claimCollection(event, "mac", "bad-id")).rejects.toMatchObject({ statusCode: 400 })
      await claimCollection(event, "mac", id)
      for (const state of ["queued", "running", "cancelled", null, ["complete"]])
        await expect(finishCollection(event, "mac", { id, state, message: "test" })).rejects.toMatchObject({ statusCode: 400 })
      expect((await collectionStatus(event)).job!.state).toBe("running")
      await finishCollection(event, "mac", { id, state: "error", message: "失败，需人工检查" })
      expect((await collectionStatus(event)).job!.state).toBe("error")
    } finally {
      sqlite.close()
    }
  })
})

describe("administrator collection HTTP boundary", () => {
  let server: Server, base: string
  const { event, sqlite } = fixture()
  beforeAll(async () => {
    const app = createApp()
    app.use(defineEventHandler((request) => {
      request.context.env = { ...event.context.env, SOURCE_ADMIN_ACCESS_TEAM_DOMAIN: "synthetic.cloudflareaccess.com", SOURCE_ADMIN_ACCESS_AUD: "a".repeat(64), SOURCE_ADMIN_EMAILS: "admin@example.com" }
      if (request.path === "/machine") return buildingHandler(request)
      return request.method === "GET" ? getCollection(request) : postCollection(request)
    }))
    server = createServer(toNodeListener(app))
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  })
  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    sqlite.close()
  })
  it("both handlers require real Access assertion before touching DB", async () => {
    for (const method of ["GET", "POST"]) {
      const response = await fetch(base, { method, headers: { "cf-access-authenticated-user-email": "admin@example.com" } })
      expect(response.status).toBe(401)
      expect(response.headers.get("cache-control")).toContain("no-store")
    }
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([])
  })
  it("machine actions require authentication, operate capability and a non-deployment owner", async () => {
    expect((await fetch(`${base}/machine`, { method: "POST" })).status).toBe(401)
    const machine = vi.spyOn(machineAuth, "machineRequest")
    try {
      for (const action of ["collection-poll", "collection-claim", "collection-finish"]) {
        machine.mockResolvedValue({ owner: "deployment", capabilities: ["operate"], body: { action } })
        expect((await fetch(`${base}/machine`, { method: "POST" })).status).toBe(403)
        machine.mockResolvedValue({ owner: "mac", capabilities: ["publish"], body: { action } })
        expect((await fetch(`${base}/machine`, { method: "POST" })).status).toBe(403)
      }
      machine.mockResolvedValue({ owner: "mac", capabilities: ["operate"], body: { action: "collection-poll" } })
      expect(await (await fetch(`${base}/machine`, { method: "POST" })).json()).toEqual({ job: null })
    } finally {
      machine.mockRestore()
    }
  })
  it("authenticated writes enforce origin, JSON size and exact collect action", async () => {
    // Only the verified principal is injected; body/origin/DB use real HTTP paths.
    const principal = vi.spyOn(auth, "requireSourceAdmin").mockResolvedValue({ email: "admin@example.com" })
    try {
      const send = (body: string, origin = base, type = "application/json") => fetch(base, { method: "POST", headers: { origin, "content-type": type }, body })
      expect((await send("{\"action\":\"collect\"}", "https://evil.example")).status).toBe(403)
      expect((await send("{\"action\":\"collect\"}", base, "text/plain")).status).toBe(415)
      expect((await send(" ".repeat(257))).status).toBe(413)
      const chunked = new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode(" ".repeat(257)))
        controller.close()
      } })
      const oversized = await fetch(base, { method: "POST", headers: { "origin": base, "content-type": "application/json" }, body: chunked, duplex: "half" } as RequestInit)
      expect(oversized.status).toBe(413)
      for (const body of ["{\"action\":\"collect\",\"command\":\"anything\"}", "{\"action\":\"collect\",\"source\":\"a\"}", "{\"action\":\"collect\",\"model\":\"a\"}", "{\"action\":\"other\"}", "null", "{"])
        expect((await send(body)).status).toBe(400)
      const response = await send("{\"action\":\"collect\"}")
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ job: { state: "queued" }, schedule: "每日05:00、12:00、16:00（北京时间）" })
    } finally {
      principal.mockRestore()
    }
  })
})
