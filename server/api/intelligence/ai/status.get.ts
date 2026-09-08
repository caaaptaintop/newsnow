import { aiEnv, settingsEnabled, readSettings, savedProfileAI } from "../../../utils/ai-settings"
import { configuredAI } from "../../../utils/ai-provider"
export default defineEventHandler(async (event) => {
  setHeader(event, "Cache-Control", "no-store")
  const env = aiEnv(event)
  const managementReady = settingsEnabled(event) && String(env.AI_ADMIN_TOKEN ?? "").length >= 32 && env.AI_ADMIN_TOKEN !== env.AI_SETTINGS_ENCRYPTION_KEY
  let ai = configuredAI(event)
  let revision = 0
  try {
    if (settingsEnabled(event)) {
      const settings = await readSettings()
      revision = settings.revision
      if (settings.data.activeId) ai = await savedProfileAI(event, settings.data.activeId, settings.data)
    }
    return { managementReady, revision, provider: ai.provider, model: ai.model, enabled: ai.enabled, configurationOnly: true }
  } catch { return { managementReady, revision, provider: "configured-unavailable", model: "配置不可用", enabled: false, configurationOnly: true } }
})
