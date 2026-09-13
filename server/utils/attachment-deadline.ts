// Cache API and D1 do not accept AbortSignal. Stop awaiting them at the deadline,
// but still observe late completion so callers can dispose responses/leases.
export function attachmentDeadline(timeoutMs: number, parent?: AbortSignal) {
  const expires = Date.now() + timeoutMs
  const controller = new AbortController()
  const abort = () => controller.abort(new DOMException("Attachment request expired or cancelled", "AbortError"))
  const timer = setTimeout(abort, timeoutMs)
  parent?.addEventListener("abort", abort, { once: true })
  if (parent?.aborted) abort()

  function check() {
    if (Date.now() >= expires) abort()
    if (controller.signal.aborted) throw controller.signal.reason
  }

  function run<T>(work: () => Promise<T>, discard?: (value: T) => void): Promise<T> {
    check()
    return new Promise<T>((resolve, reject) => {
      const cancelled = () => reject(controller.signal.reason)
      controller.signal.addEventListener("abort", cancelled, { once: true })
      let pending: Promise<T>
      try {
        pending = work()
      } catch (error) {
        controller.signal.removeEventListener("abort", cancelled)
        reject(error)
        return
      }
      void pending.then((value) => {
        controller.signal.removeEventListener("abort", cancelled)
        try {
          check()
        } catch (error) {
          try {
            discard?.(value)
          } catch { /* Disposal failure cannot resume an expired request. */ }
          reject(error)
          return
        }
        resolve(value)
      }, (error) => {
        controller.signal.removeEventListener("abort", cancelled)
        reject(error)
      })
    })
  }

  return {
    signal: controller.signal,
    check,
    run,
    remaining: () => expires - Date.now(),
    dispose() {
      clearTimeout(timer)
      parent?.removeEventListener("abort", abort)
    },
  }
}
