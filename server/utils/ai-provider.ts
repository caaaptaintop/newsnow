import { configuredAI as legacyConfiguredAI } from "../providers/legacy-ai-provider"

/** Per-request runtime prepared by middleware; never accept provider credentials from classifier requests. */
export function configuredAI(event: any) {
  if (event?.context?.aiSettingsError) return { provider: "configured-unavailable", model: "配置不可用", enabled: false, run: undefined, models: undefined }
  return event?.context?.aiConfiguredRuntime ?? legacyConfiguredAI(event)
}
