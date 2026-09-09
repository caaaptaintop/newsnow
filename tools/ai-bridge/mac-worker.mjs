import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

export const workerSources = ["all"]
export const workerModel = "gpt-5.6-luna"
export function shouldRun(status, now = Date.now()) {
  return !status?.retryAfter || now >= status.retryAfter
}
export function runWorker(root, run = command, now = Date.now()) {
  const directory = resolve(root, ".data/mac-batch")
  mkdirSync(directory, { recursive: true })
  const stateFile = resolve(directory, "worker-status.json")
  const read = file => existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
  const previous = read(stateFile)
  if (!shouldRun(previous, now)) return { ...previous, skipped: "cooldown" }
  const lockFile = resolve(directory, "worker.lock")
  if (existsSync(lockFile)) {
    const pid = Number(readFileSync(lockFile, "utf8"))
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("Invalid worker lock; manual inspection needed")
    try {
      process.kill(pid, 0)
      return { skipped: "already-running" }
    } catch (error) {
      if (error.code !== "ESRCH") throw error
      unlinkSync(lockFile)
    }
  }
  writeFileSync(lockFile, String(process.pid), { flag: "wx" })
  const status = { startedAt: now, model: workerModel, reasoning: "low", state: "running", completedSources: [], retryAfter: 0 }
  const save = () => {
    writeFileSync(`${stateFile}.pending`, `${JSON.stringify(status, null, 2)}\n`)
    renameSync(`${stateFile}.pending`, stateFile)
  }
  const call = (bin, args, timeout = 180000) => run(bin, args, root, timeout)
  try {
    save()
    if (call("git", ["branch", "--show-current"]).trim() !== "main" || call("git", ["status", "--porcelain"]).trim()) throw new Error("Checkout must be clean and on main")
    call("git", ["pull", "--ff-only", "origin", "main"])
    if (!/Logged in using ChatGPT/.test(call("codex", ["login", "status"]))) throw new Error("ChatGPT login required")
    for (const source of workerSources) {
      call(resolve(root, "node_modules/.bin/tsx"), ["--tsconfig", "tsconfig.node.json", "tools/ai-bridge/mac-batch.ts", "--source", source, "--limit", "12", "--model", workerModel], 1800000)
      status.completedSources.push(source)
      save()
    }
    if (existsSync(resolve(directory, "result.json"))) {
      call(resolve(root, "node_modules/.bin/tsx"), ["--tsconfig", "tsconfig.node.json", "tools/ai-bridge/apply-batch.ts"])
      if (call("git", ["diff", "--name-only", "--", "data/intelligence-snapshot.json", "shared/intelligence-snapshot.ts"]).trim()) {
        call("git", ["diff", "--check"])
        call("git", ["add", "data/intelligence-snapshot.json", "shared/intelligence-snapshot.ts"])
        call("git", ["commit", "-m", "chore(data): publish Mac Luna subscription batch"])
      }
    }
    // Also recovers a previously committed batch whose push failed, without reclassifying it.
    call("git", ["push", "origin", "main"])
    status.state = "complete"
    status.finishedAt = Date.now()
    status.head = call("git", ["rev-parse", "HEAD"]).trim()
  } catch (error) {
    status.state = "error"
    status.error = error.message
    // launchd already spaces attempts by 15 minutes; do not add an hour after wake.
    status.retryAfter = 0
    status.finishedAt = Date.now()
  } finally {
    save()
    unlinkSync(lockFile)
  }
  return status
}
function command(bin, args, cwd, timeout) {
  const result = spawnSync(bin, args, { cwd, encoding: "utf8", timeout, maxBuffer: 1048576, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } })
  if (result.error || result.status !== 0) throw new Error(`${bin.split("/").pop()} ${args[0]} failed (exit ${result.status ?? "timeout"}); check local login/network or checkout`)
  // Login status is written to stderr by Codex; no authentication file is read.
  return bin === "codex" ? result.stdout + result.stderr : result.stdout
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const status = runWorker(resolve(process.argv[2] ?? import.meta.dirname, process.argv[2] ? "." : "../.."))
  console.log(JSON.stringify(status))
  process.exitCode = status.state === "error" ? 1 : 0
}
