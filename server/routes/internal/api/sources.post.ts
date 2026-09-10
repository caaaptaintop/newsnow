import { createError, defineEventHandler, readBody, setHeader } from "h3"
import { intelligenceSources } from "../../../../shared/official-sources"
import { validateIntelligenceSourceConfig } from "../../../../shared/source-config"
import { testSourceConfig } from "../../../source-admin/test-source-config"
import { requireSameOriginWrite, requireSourceAdmin } from "../../../utils/source-admin-auth"
import { publishSourceDraft, rollbackSourceConfig, saveSourceDraft, saveSourceTest } from "../../../utils/source-config-store"

export default defineEventHandler(async (event) => {
  const principal = await requireSourceAdmin(event)
  requireSameOriginWrite(event)
  setHeader(event, "cache-control", "no-store")
  const body = await readBody<Record<string, unknown>>(event)
  const action = String(body?.action ?? "")
  const topic = String(body?.topic ?? "")
  const sourceId = String(body?.sourceId ?? "")
  const seed = intelligenceSources.find(source => source.topic === topic && source.id === sourceId)
  if (!seed) throw createError({ statusCode: 404, statusMessage: "Unknown source" })
  if (action === "save-draft") return saveSourceDraft(event, topic, sourceId, body.config, principal.email)
  if (action === "test") {
    const config = validateIntelligenceSourceConfig(body.config, seed)
    const draft = await saveSourceDraft(event, topic, sourceId, config, principal.email)
    const result = await testSourceConfig(draft.config)
    const saved = await saveSourceTest(event, topic, sourceId, draft.config, result, result.ok, principal.email)
    return { ...saved, config: draft.config, result }
  }
  if (action === "publish") {
    const hash = String(body.hash ?? "")
    if (!/^[a-f0-9]{64}$/.test(hash)) throw createError({ statusCode: 400, statusMessage: "Invalid draft hash" })
    return publishSourceDraft(event, topic, sourceId, hash, principal.email)
  }
  if (action === "rollback") {
    const revision = Number(body.revision)
    if (!Number.isInteger(revision) || revision < 1) throw createError({ statusCode: 400, statusMessage: "Invalid revision" })
    return rollbackSourceConfig(event, topic, sourceId, revision, principal.email)
  }
  throw createError({ statusCode: 400, statusMessage: "Unknown action" })
})
