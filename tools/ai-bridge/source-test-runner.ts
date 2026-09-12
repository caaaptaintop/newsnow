import { publisherRequest } from "./publisher.mjs"
import { testSourceConfig, type SourceConfigTestResult } from "../../server/source-admin/test-source-config"
import type { IntelligenceSourceConfig } from "../../shared/source-config"

interface RuntimeTestJob {
  topic: string
  sourceId: string
  config: IntelligenceSourceConfig
  hash: string
  activeRevision: number
  requestedAt: number
}

export async function runPendingSourceTests({ limit = 1, request = publisherRequest, tester = testSourceConfig } = {}) {
  const pending = await request({ action: "source-tests", limit }) as { jobs?: RuntimeTestJob[] }
  const jobs = Array.isArray(pending.jobs) ? pending.jobs.slice(0, Math.max(1, Math.min(4, limit))) : []
  const completed: Array<{ sourceId: string, publishable: boolean, testedAt: number }> = []
  for (const job of jobs) {
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
  const result = await runPendingSourceTests({ limit: Number(process.argv[2] ?? 1) })
  console.log(JSON.stringify(result))
}
