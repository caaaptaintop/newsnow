// Retain the bounded buffer until the consumer requests EOF, cancels, or fails.
// No read-ahead: enqueueing the last chunk does not release the slot.
export function attachmentDelivery(bytes: ArrayBuffer, finish: (failed: boolean) => void, signal?: AbortSignal, timeoutMs = 30000) {
  let buffer: Uint8Array | undefined = new Uint8Array(bytes)
  let offset = 0
  let ended = false
  let controller: ReadableStreamDefaultController<Uint8Array>
  let timer: ReturnType<typeof setTimeout> | undefined
  const end = (failed: boolean) => {
    if (ended) return
    ended = true
    buffer = undefined
    clearTimeout(timer)
    signal?.removeEventListener("abort", abort)
    finish(failed)
  }
  function abort() {
    if (ended) return
    controller.error(new DOMException("Attachment delivery cancelled", "AbortError"))
    end(true)
  }
  return new ReadableStream<Uint8Array>({
    start(value) {
      controller = value
      signal?.addEventListener("abort", abort, { once: true })
      timer = setTimeout(abort, Math.max(0, timeoutMs))
      if (signal?.aborted) abort()
    },
    pull(value) {
      if (!buffer) return
      if (offset === buffer.byteLength) {
        value.close()
        end(false)
        return
      }
      const next = Math.min(offset + 64 * 1024, buffer.byteLength)
      value.enqueue(buffer.subarray(offset, next))
      offset = next
    },
    cancel() {
      end(true)
    },
  }, { highWaterMark: 0 })
}
