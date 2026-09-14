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
export function completion(root, result) {
  if (result.state !== "complete" || result.skipped) return { state: "error", message: "采集未完成，请检查Mac运行状态后重试" }
  const path = resolve(root, ".data/mac-batch/result.json")
  const states = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")).states ?? []).filter(s => s.checkedAt >= result.startedAt) : []
  if (states.length && states.every(s => s.status === "error")) return { state: "error", message: "本轮所有信息源采集失败，未获取新文章" }
  if (states.some(s => s.status !== "ok")) return { state: "complete", message: "发布流程完成，部分信息源受限；请查看来源运行状态" }
  return { state: "complete", message: "采集与发布流程完成；没有新文章时内容保持不变" }
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
    try {
      result = await worker(root)
    } catch {
      result = { state: "error" }
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
