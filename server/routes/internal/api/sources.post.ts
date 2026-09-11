import { createError, defineEventHandler, getHeader, getRequestWebStream, setHeader } from "h3"
import { intelligenceSources } from "../../../../shared/official-sources"
import { sourceConfigPolicy, validateIntelligenceSourceConfig, validateSourceDraftBase } from "../../../../shared/source-config"
import { testSourceConfig } from "../../../source-admin/test-source-config"
import { requireSameOriginWrite, requireSourceAdmin } from "../../../utils/source-admin-auth"
import { publishSourceDraft, rollbackSourceConfig, saveSourceDraft, saveSourceTest } from "../../../utils/source-config-store"

const runningTests = new Set<string>()
export default defineEventHandler(async (event) => {
  setHeader(event, "cache-control", "private, no-store")
  const principal = await requireSourceAdmin(event)
  requireSameOriginWrite(event)
  if (!/^application\/json(?:;|$)/i.test(getHeader(event, "content-type") ?? "")) throw createError({ statusCode: 415, message: "只接受 JSON 配置" })
  const stream = getRequestWebStream(event)
  if (!stream) throw createError({ statusCode: 400, message: "缺少配置请求" })
  const reader = stream.getReader(), decoder = new TextDecoder()
  let json = "", size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > sourceConfigPolicy.maxRequestBytes) { await reader.cancel(); throw createError({ statusCode: 413, message: "配置请求过大" }) }
      json += decoder.decode(value, { stream: true })
    }
    json += decoder.decode()
  }
  finally { reader.releaseLock() }
  let body: Record<string, unknown>
  try {
    body = JSON.parse(json)
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error()
  }
  catch { throw createError({ statusCode: 400, message: "配置请求格式错误" }) }
  const action = String(body.action ?? ""), topic = String(body.topic ?? ""), sourceId = String(body.sourceId ?? "")
  const seed = intelligenceSources.find(source => source.topic === topic && source.id === sourceId)
  if (!seed) throw createError({ statusCode: 404, message: "未注册的信息源" })
  try {
    const base = validateSourceDraftBase(body.base)
    if (action === "save-draft") return await saveSourceDraft(event, topic, sourceId, body.config, principal.email, base)
    if (action === "test") {
      const key = `${principal.email}:${topic}:${sourceId}`
      if (runningTests.has(key)) throw createError({ statusCode: 429, message: "该来源正在测试，请等待完成" })
      runningTests.add(key)
      try {
        const config = validateIntelligenceSourceConfig(body.config, seed)
        const draft = await saveSourceDraft(event, topic, sourceId, config, principal.email, base)
        const startedAt = Date.now()
        const result = await testSourceConfig(draft.config)
        const saved = await saveSourceTest(event, topic, sourceId, draft.config, result, principal.email,
          { draftHash: draft.hash, activeRevision: draft.activeRevision }, startedAt)
        return { ...draft, ...saved, result }
      }
      finally { runningTests.delete(key) }
    }
    if (action === "publish") {
      const hash = body.hash
      if (typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash) || hash !== base.draftHash) throw new Error("草稿指纹无效")
      return await publishSourceDraft(event, topic, sourceId, hash, principal.email, base.activeRevision, Number(body.testedAt))
    }
    if (action === "rollback") {
      const revision = Number(body.revision)
      if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("历史版本无效")
      return await rollbackSourceConfig(event, topic, sourceId, revision, principal.email, base)
    }
    throw new Error("未知配置操作")
  }
  catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) throw error
    throw createError({ statusCode: 400, message: error instanceof Error ? error.message.slice(0, 240) : "无效配置" })
  }
})
