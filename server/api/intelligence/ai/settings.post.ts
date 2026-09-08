import { requireAIAdmin, settingsBody, saveSettings } from "../../../utils/ai-settings"
export default defineEventHandler(async (event) => {
  await requireAIAdmin(event)
  return saveSettings(event, await settingsBody(event))
})
