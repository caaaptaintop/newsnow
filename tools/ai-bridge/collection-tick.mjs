import process from "node:process"
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { runWorker } from "./mac-worker.mjs"
import { publisherRequest } from "./publisher.mjs"

export function scheduledSlot(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).map(p => [p.type, p.value]))
  return ["05", "12", "16"].includes(parts.hour) ? `${parts.year}-${parts.month}-${parts.day}T${parts.hour}` : null
}
export function blockedByLock(path) {
  if (!existsSync(path)) return false
  const raw = readFileSync(path, "utf8")
  const pid = Number(raw)
  if (!Number.isInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error.code !== "ESRCH") return true
    throw new Error("发现失效采集锁；保留现场，需核对进程后处理")
  }
}
function saveJson(path, value) {
  const temporary = `${path}.pending`
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  const fd = openSync(temporary, "r")
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(temporary, path)
  const directory = openSync(dirname(path), "r")
  try {
    fsyncSync(directory)
  } finally {
    closeSync(directory)
  }
}
export function resultMessage(states, result) {
  const count = value => Number.isSafeInteger(value) && value >= 0
  const measured = states.length > 0 && states.every(s => s.collectionCounts && ["discovered", "duplicates", "failed"].every(k => count(s.collectionCounts[k])))
  const sum = key => states.reduce((n, s) => n + s.collectionCounts[key], 0)
  const publication = result.publication
  const published = result.state === "complete" && count(publication?.publishedArticles) && count(publication?.updatedArticles)
    ? `新发布 ${publication.publishedArticles} 条 · 更新 ${publication.updatedArticles} 条`
    : "发布条数未确认"
  const counts = measured ? `新发现 ${sum("discovered")} 条 · ${published} · 重复跳过 ${sum("duplicates")} 条 · 处理失败 ${sum("failed")} 条` : `本轮采集条数未记录 · ${published}`
  const errors = states.filter(s => s.status === "error").length
  const partial = states.filter(s => s.status === "partial").length
  return `${counts}；${states.length ? `来源异常 ${errors} 个、部分成功 ${partial} 个` : "来源状态未确认"}`
}
export function completion(root, result) {
  const path = resolve(root, ".data/mac-batch/result.json")
  const states = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")).states ?? []).filter(s => s.checkedAt >= result.startedAt) : []
  const message = resultMessage(states, result)
  if (result.state !== "complete" || result.skipped) return { state: "error", message: `${message}；流程未完成，请检查后重试` }
  if (states.length && states.every(s => s.status === "error")) return { state: "error", message }
  return { state: "complete", message }
}
export async function collectionTick(root, { request = publisherRequest, worker = runWorker, now = new Date() } = {}) {
  const dir = resolve(root, ".data/mac-batch")
  mkdirSync(dir, { recursive: true })
  const lock = resolve(dir, "collection-tick.lock")
  if (blockedByLock(lock) || blockedByLock(resolve(dir, "worker.lock")) || blockedByLock(resolve(dir, "running.lock"))) return { skipped: "busy" }
  let owned = false
  try {
    writeFileSync(lock, String(process.pid), { flag: "wx" })
    owned = true
    const receiptPath = resolve(dir, "collection-receipt.json")
    if (existsSync(receiptPath)) {
      const receipt = JSON.parse(readFileSync(receiptPath, "utf8"))
      try {
        await request({ action: "collection-finish", ...receipt })
      } catch (error) {
        if (error.statusCode !== 409) throw error
      }
      unlinkSync(receiptPath)
    }
    const statePath = resolve(dir, "collection-schedule.json")
    const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {}
    let job = null
    try {
      job = (await request({ action: "collection-poll" })).job
    } catch { /* A control-plane failure must not stop scheduled collection. */ }
    const slot = scheduledSlot(now)
    const due = slot && state.lastSlot !== slot
    if (!job && !due) return { skipped: "not-due" }
    if (job) {
      saveJson(receiptPath, { id: job.id, state: "error", message: "上次执行中断，结果未确认；未自动重复采集，请检查后手动重试" })
      const claimed = await request({ action: "collection-claim", id: job.id })
      if (!claimed.claimed) {
        unlinkSync(receiptPath)
        return { skipped: "already-claimed" }
      }
    }
    // Claim the scheduled slot before execution;
    // Failures require a deliberate manual retry.
    if (due) {
      saveJson(statePath, { lastSlot: slot })
    }
    let result
    const startedAt = Date.now()
    try {
      result = await worker(root)
    } catch {
      result = { state: "error", startedAt }
    }
    if (job) {
      const receipt = { id: job.id, ...completion(root, result) }
      saveJson(receiptPath, receipt)
      await request({ action: "collection-finish", ...receipt })
      unlinkSync(receiptPath)
    }
    return result
  } catch (error) {
    if (error.code === "EEXIST" && !owned) return { skipped: "tick-busy" }
    throw error
  } finally {
    if (owned && readFileSync(lock, "utf8") === String(process.pid))unlinkSync(lock)
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../.."))
  try {
    console.log(JSON.stringify(await collectionTick(root)))
  } catch {
    console.error("采集调度检查失败；未自动重试任务")
    process.exitCode = 1
  }
}
