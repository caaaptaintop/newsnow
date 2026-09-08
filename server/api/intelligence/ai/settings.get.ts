import { requireAIAdmin, readSettings, publicSettings } from "../../../utils/ai-settings"
export default defineEventHandler(async (event) => {
  await requireAIAdmin(event)
  const settings = await readSettings()
  return publicSettings(settings.revision, settings.data)
})
