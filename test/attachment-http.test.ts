import { Buffer } from "node:buffer"
import type { IncomingMessage, ServerResponse } from "node:http"
import { Readable, Writable } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { backupSignature } from "../server/utils/attachment-backup"
import { createBackupHandler } from "../tools/attachment-relay/service"
import { backupHttpHandler } from "../tools/attachment-relay/http"

const secret = "synthetic-test-key-not-a-real-secret-88"
async function request() {
  const body = JSON.stringify({ url: "https://www.mohurd.gov.cn/cms_files/filemanager/1/attach/1/test.doc", referer: "https://www.mohurd.gov.cn/article", filename: "test.doc", nonce: crypto.randomUUID(), issuedAt: Date.now() })
  return Object.assign(Readable.from([Buffer.from(body)]), { method: "POST", url: "/attachment", headers: { "content-type": "application/json", "x-attachment-signature": await backupSignature(secret, body) } }) as unknown as IncomingMessage
}
class SlowResponse extends Writable {
  status = 0
  headersSent = false
  writes = 0
  pending: (() => void) | undefined
  paused = true
  writeHead(status: number) {
    this.status = status
    this.headersSent = true
    return this
  }

  _write(_chunk: unknown, _encoding: string, callback: () => void) {
    this.writes++
    if (this.paused) this.pending = callback
    else callback()
  }

  resumeWrites() {
    this.paused = false
    this.pending?.()
    this.pending = undefined
  }
}

describe("mac HTTP response lifecycle", () => {
  it("times out a blocked final HTTP write after the body has reached EOF", async () => {
    vi.useFakeTimers()
    const response = new SlowResponse({ highWaterMark: 1 })
    const finish = vi.fn()
    const handle = backupHttpHandler(async (_request, done) => {
      void done.then(finish)
      return new Response(new Uint8Array([1]))
    })
    const req = await request()
    const job = handle(req, response as unknown as ServerResponse)
    try {
      await vi.waitFor(() => expect(response.writes).toBe(1))
      expect(finish).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(30000)
      await job
      expect(response.destroyed).toBe(true)
      expect(finish).toHaveBeenCalledOnce()
    } finally {
      response.destroy()
      await job
      vi.useRealTimers()
    }
  })
  it.each(["finish", "close", "error"])("holds five slots under backpressure until HTTP %s", async (ending) => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array(256 * 1024)))
    const handle = backupHttpHandler(createBackupHandler(secret, fetcher))
    const responses: SlowResponse[] = []
    const jobs: Promise<void>[] = []
    const start = async () => {
      const response = new SlowResponse({ highWaterMark: 1 })
      responses.push(response)
      jobs.push(handle(await request(), response as unknown as ServerResponse))
      return response
    }
    try {
      for (let i = 0; i < 5; i++) await start()
      await vi.waitFor(() => expect(responses.slice(0, 5).every(r => r.writes === 1)).toBe(true))
      const rejected = await start()
      await vi.waitFor(() => expect(rejected.status).toBe(429))
      expect(fetcher).toHaveBeenCalledTimes(5)
      if (ending === "finish") responses[0].resumeWrites()
      else responses[0].destroy(ending === "error" ? new Error("synthetic send failure") : undefined)
      await jobs[0]
      const next = await start()
      await vi.waitFor(() => expect(next.status).toBe(200))
      expect(fetcher).toHaveBeenCalledTimes(6)
      expect(responses[1].writableFinished).toBe(false)
    } finally {
      for (const response of responses) response.destroy()
      await Promise.all(jobs)
    }
  })
})
