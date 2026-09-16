import { Buffer } from "node:buffer"
import { safeDiagnostic } from "../../shared/runtime-diagnostic.mjs"

export { safeDiagnostic }

export function diagnosticFromError(error, limit = 260) {
  const stderr = typeof error?.stderr === "string" || Buffer.isBuffer(error?.stderr) ? String(error.stderr) : ""
  const stdout = typeof error?.stdout === "string" || Buffer.isBuffer(error?.stdout) ? String(error.stdout) : ""
  return safeDiagnostic(stderr || error?.message || stdout, limit)
}
