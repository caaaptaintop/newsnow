import "./custom-source-http"
import process from "node:process"
import { type SourceConfigTestResult, testSourceConfig } from "../../server/source-admin/test-source-config"
import { type IntelligenceSourceConfig, customSourceSeed, validateIntelligenceSourceConfig } from "../../shared/source-config"
import { intelligenceSources } from "../../shared/official-sources"
import { publisherRequest } from "./publisher.mjs"

export function runtimeTestAllowed(job: RuntimeTestJob) {
  // Jobs exist only after an authenticated administrator requests a draft test.
  try {
    const source = intelligenceSources.find(s => s.id === job.sourceId && s.topic === job.topic) ?? customSourceSeed(job.config)
    if (!source || source.id !== job.sourceId || source.topic !== job.topic) return false
    validateIntelligenceSourceConfig(job.config, source)
    return true
  } catch {
    return false
  }
}

interface RuntimeTestJob {
  topic: string
  sourceId: string
  config: IntelligenceSourceConfig
  hash: string
  activeRevision: number
  requestedAt: number
}

export async function runPendingSourceTests({ limit = 1, request = publisherRequest, tester = testSourceConfig, allowed = (_job: RuntimeTestJob): boolean => true } = {}) {
  const pending = await request({ action: "source-tests", limit }) as { jobs?: RuntimeTestJob[] }
  const jobs = Array.isArray(pending.jobs) ? pending.jobs.slice(0, Math.max(1, Math.min(4, limit))) : []
  const completed: Array<{ sourceId: string, publishable: boolean, testedAt: number }> = []
  for (const job of jobs) {
    if (!allowed(job)) continue
    const startedAt = Date.now()
    const result = await tester(job.config) as SourceConfigTestResult
    const saved = await request({
      action: "source-test-result",
      topic: job.topic,
      sourceId: job.sourceId,
      hash: job.hash,
      activeRevision: job.activeRevision,
      requestedAt: job.requestedAt,
      startedAt,
      result: { ...result, executor: "mac", runtimePending: false },
    }) as { publishable?: boolean, testedAt?: number }
    completed.push({ sourceId: job.sourceId, publishable: saved.publishable === true, testedAt: Number(saved.testedAt ?? startedAt) })
  }
  return { pending: jobs.length, completed }
}

if (process.argv[1]?.endsWith("source-test-runner.ts")) {
  const result = await runPendingSourceTests({ limit: Number(process.argv[2] ?? 1), allowed: runtimeTestAllowed })
  console.log(JSON.stringify(result))
}
