import process from "node:process"
import { type SourceConfigTestResult, testSourceConfig } from "../../server/source-admin/test-source-config"
import type { IntelligenceSourceConfig } from "../../shared/source-config"
import { publisherRequest } from "./publisher.mjs"
import { collectionColumns, collectionSourceAllowed } from "./collection-scope"

export function runtimeTestAllowed(job: RuntimeTestJob) {
  const config = job.config
  const endpoints = config?.endpoints?.filter(e => e.enabled)
  return collectionSourceAllowed(job.sourceId) && config.id === job.sourceId
    && config.home === "https://www.mohurd.gov.cn/" && config.collectionMode === "explicit"
    && endpoints?.length === collectionColumns.size
    && new Set(endpoints.map(e => e.name)).size === collectionColumns.size
    && endpoints.every(e => collectionColumns.get(e.name) === e.url)
}

interface RuntimeTestJob {
  topic: string
  sourceId: string
  config: IntelligenceSourceConfig
  hash: string
  activeRevision: number
  requestedAt: number
}

export async function runPendingSourceTests({ limit = 1, request = publisherRequest, tester = testSourceConfig, allowed = (_job: RuntimeTestJob) => true } = {}) {
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
