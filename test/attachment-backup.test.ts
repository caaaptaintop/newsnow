import { describe, expect, it, vi } from "vitest"
import { backupAttachment, backupSignature } from "../server/utils/attachment-backup"
import { createBackupHandler } from "../tools/attachment-relay/service"

const secret = "synthetic-test-key-not-a-real-secret-88"
const input = { url: "https://www.mohurd.gov.cn/api-gateway/jpaas-web-server/front/document/download?fileName=test.docx", referer: "https://www.mohurd.gov.cn/article", filename: "test.docx" }
async function signed(extra = {}, timestamp = Date.now()) {
  const body = JSON.stringify({ ...input, nonce: crypto.randomUUID(), issuedAt: timestamp, ...extra })
  return new Request("http://localhost/attachment", { method: "POST", body, headers: { "content-type": "application/json", "x-attachment-signature": await backupSignature(secret, body) } })
}
describe("private Mac attachment backup", () => {
  it("accepts signed requests once and blocks tampering, stale requests and other origins before network access", async () => {
    const fetcher = vi.fn(async () => new Response("file"))
    const handle = createBackupHandler(secret, fetcher)
    const valid = await signed()
    expect((await handle(valid.clone())).status).toBe(200)
    expect((await handle(valid)).status).toBe(409)
    expect((await handle(await signed({}, 100))).status).toBe(403)
    expect((await handle(await signed({ url: "https://other.gov.cn/file" }))).status).toBe(403)
    const tampered = await signed()
    tampered.headers.set("x-attachment-signature", "0".repeat(64))
    expect((await handle(tampered)).status).toBe(401)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it("allows five active files, rejects the sixth and releases slots after completion or failure", async () => {
    const pending: Array<{ resolve: (value: Response) => void, reject: (reason: Error) => void }> = []
    const handle = createBackupHandler(secret, () => new Promise<Response>((resolve, reject) => pending.push({ resolve, reject })))
    const requests = []
    for (let i = 0; i < 5; i++) requests.push(handle(await signed()))
    await vi.waitFor(() => expect(pending).toHaveLength(5))
    expect((await handle(await signed())).status).toBe(429)
    pending[0].reject(new Error("origin unavailable"))
    expect((await requests[0]).status).toBe(503)
    requests.push(handle(await signed()))
    await vi.waitFor(() => expect(pending).toHaveLength(6))
    for (const item of pending.slice(1)) item.resolve(new Response("file"))
    for (const response of await Promise.all(requests.slice(1))) expect(response.status).toBe(200)
    const next = handle(await signed())
    await vi.waitFor(() => expect(pending).toHaveLength(7))
    pending[6].resolve(new Response("file"))
    expect((await next).status).toBe(200)
  })
  it("rejects off-origin redirects without following them", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://other.gov.cn/file" } }))
    expect((await createBackupHandler(secret, fetcher)(await signed())).status).toBe(503)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it("transfers through the signed client and preserves bytes without cookies", async () => {
    const handle = createBackupHandler(secret, async () => new Response("file", { headers: { "set-cookie": "no", "content-type": "text/plain" } }))
    const fetcher = vi.fn(async (url: any, options: any) => handle(new Request(url, options)))
    const response = await backupAttachment(input, { ATTACHMENT_BACKUP_URL: "https://backup.example.com/attachment", ATTACHMENT_BACKUP_SECRET: secret }, undefined, fetcher)
    expect(await response.text()).toBe("file")
    expect(fetcher.mock.calls[0][1].redirect).toBe("manual")
    expect(response.headers.has("set-cookie")).toBe(false)
  })
  it("fails closed when the backup is unconfigured or unavailable", async () => {
    const fetcher = vi.fn(async () => new Response("offline", { status: 503 }))
    await expect(backupAttachment(input, {}, undefined, fetcher)).rejects.toMatchObject({ statusCode: 503 })
    expect(fetcher).not.toHaveBeenCalled()
    await expect(backupAttachment(input, { ATTACHMENT_BACKUP_URL: "https://backup.example.com/attachment", ATTACHMENT_BACKUP_SECRET: secret }, undefined, fetcher)).rejects.toMatchObject({ statusCode: 503 })
  })
})
