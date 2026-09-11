import { defineEventHandler, setHeader } from "h3"
import { sourceAdminPage } from "../../source-admin/page"
import { requireSourceAdmin } from "../../utils/source-admin-auth"

export default defineEventHandler(async (event) => {
  const nonce = crypto.randomUUID().replace(/-/g, "")
  const principal = await requireSourceAdmin(event)
  setHeader(event, "content-type", "text/html; charset=utf-8")
  setHeader(event, "cache-control", "no-store")
  setHeader(event, "content-security-policy", `default-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`)
  setHeader(event, "x-frame-options", "DENY")
  return sourceAdminPage(principal.email, nonce)
})
