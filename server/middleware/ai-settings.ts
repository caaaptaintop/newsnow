import { publicSite } from "@shared/public-site"
import { readSettings, savedProfileAI, settingsEnabled } from "../utils/ai-settings"

export default defineEventHandler(async (event) => {
  if (publicSite.readOnly) return // Public reads must never initialize any AI provider.
  const path = getRequestURL(event).pathname
  if (/^\/api\/intelligence\/attachment\/?$/.test(path)) return // Preview must not initialize AI settings or providers.
  if (!(path.startsWith("/api/intelligence") || path.startsWith("/api/topics/health")) || path.startsWith("/api/intelligence/ai/")) return
  if (!settingsEnabled(event)) return
  try {
    const settings = await readSettings()
    event.context.aiSettingsRevision = settings.revision
    if (settings.data.activeId) event.context.aiConfiguredRuntime = await savedProfileAI(event, settings.data.activeId, settings.data)
  } catch {
    // A broken selected profile must never trigger an unapproved paid fallback.
    event.context.aiSettingsError = true
  }
})
