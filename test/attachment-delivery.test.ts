import { describe, expect, it, vi } from "vitest"
import { attachmentDelivery } from "../server/utils/attachment-delivery"

describe("bounded attachment delivery", () => {
  it("does not release when the final chunk is merely queued", async () => {
    const finish = vi.fn()
    const reader = attachmentDelivery(new Uint8Array([1]).buffer, finish).getReader()
    expect((await reader.read()).value).toEqual(new Uint8Array([1]))
    expect(finish).not.toHaveBeenCalled()
    expect((await reader.read()).done).toBe(true)
    expect(finish).toHaveBeenCalledExactlyOnceWith(false)
  })
  it.each(["abort", "timeout"])("errors and releases once on %s even with a paused consumer", async (mode) => {
    vi.useFakeTimers()
    try {
      const finish = vi.fn()
      const abort = new AbortController()
      const reader = attachmentDelivery(new ArrayBuffer(131072), finish, abort.signal, 100).getReader()
      await reader.read()
      if (mode === "abort") abort.abort()
      else await vi.advanceTimersByTimeAsync(100)
      await expect(reader.read()).rejects.toMatchObject({ name: "AbortError" })
      abort.abort()
      await vi.advanceTimersByTimeAsync(100)
      expect(finish).toHaveBeenCalledExactlyOnceWith(true)
    } finally {
      vi.useRealTimers()
    }
  })
})
