import { Buffer } from "node:buffer"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { chmod, mkdir, readFile, readdir } from "node:fs/promises"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import process from "node:process"
import { agyModel, agyRoot, cleanupSession, durableJson, jsonFile, pidAlive, recoverSessions, sessionSocket, verifyAgyBinary } from "./antigravity-session.mjs"

const quote = value => `'${value.replaceAll("'", "'\\''")}'`
export async function localAntigravity(model, messages, onUsage = (_usage) => {}, options = {}) {
  if (model !== agyModel) throw new Error("Only verified AGY 3.8 Flash low is enabled")
  const payload = JSON.stringify(messages)
  if (!Array.isArray(messages) || messages.some(m => !["system", "user"].includes(m.role) || typeof m.content !== "string") || Buffer.byteLength(payload) > 1500000) throw new Error("Invalid or oversized AGY classification input")
  const binary = join(homedir(), "Library/Application Support/CapxNewsNow/bin/agy-1.2.2")
  await verifyAgyBinary(binary)
  const base = resolve(import.meta.dirname, "../../.data/agy-sessions")
  await recoverSessions(base)
  const runDir = join(base, randomUUID())
  await mkdir(join(runDir, ".agents"), { recursive: true, mode: 0o700 })
  const config = { runDir, root: agyRoot, nonce: randomUUID(), parentPid: process.pid, childPid: null, existingIds: [...new Set((await Promise.all(["conversations", "brain", "annotations", "presence"].map(name => readdir(join(agyRoot, name))))).flat().map(name => name.slice(0, 36)))] }
  await durableJson(join(runDir, "config.json"), config)
  const socketPath = sessionSocket(config.nonce)
  let server
  let delivered = false
  let outcome
  let failure
  try {
    server = createServer((socket) => {
      let data = ""
      socket.setTimeout(5000, () => socket.destroy())
      socket.on("data", async (chunk) => {
        data += chunk
        if (data.length > 2000) return socket.destroy()
        if (!data.includes("\n")) return
        socket.pause()
        try {
          const request = JSON.parse(data)
          const saved = await jsonFile(join(runDir, "config.json"))
          const owned = await jsonFile(join(runDir, "owned.json"))
          if (delivered || saved.childPid !== config.childPid || !pidAlive(saved.childPid, true) || saved.parentPid !== process.pid || request.nonce !== config.nonce || request.id !== owned.id || owned.nonce !== config.nonce) throw new Error("Unverified AGY input channel")
          delivered = true
          socket.end(payload)
        } catch {
          socket.destroy()
        }
      })
      socket.on("error", () => {})
    })
    await new Promise((accept, reject) => {
      server.once("error", reject)
      server.listen(socketPath, accept)
    })
    await chmod(socketPath, 0o600)
    const command = `${quote(process.execPath)} ${quote(resolve(import.meta.dirname, "antigravity-hook.mjs"))}`
    await durableJson(join(runDir, ".agents/hooks.json"), { "newsnow-text-only": { PreInvocation: [{ command: `${command} pre`, timeout: 10 }], PreToolUse: [{ matcher: ".*", hooks: [{ command: `${command} tool`, timeout: 10 }] }] } })
    const env = { ...process.env, NEWSNOW_AGY_RUN_DIR: runDir, AGY_CLI_DISABLE_AUTO_UPDATE: "1" }
    for (const key of ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION", "GOOGLE_GENAI_USE_VERTEXAI", "AGY_ADC_AUTH", "OPENAI_API_KEY", "CODEX_API_KEY"]) delete env[key]
    outcome = await new Promise((accept, reject) => {
      const child = spawn(binary, ["--new-project", "--model", model, "--effort", "low", "--sandbox", "--mode", "plan", "--output-format", "stream-json", "--print-timeout", "120s", "--log-file", "/dev/null", "-p", "Perform the classification supplied by the NewsNow pre-invocation hook. No tools. Return only its requested JSON."], { cwd: runDir, env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
      let pending = ""
      let bytes = 0
      let init
      let result
      let stopped
      let killTimer
      const stop = (error) => {
        if (stopped) return
        stopped = error
        try {
          process.kill(-child.pid, "SIGTERM")
        } catch {}
        killTimer = setTimeout(() => {
          try {
            process.kill(-child.pid, "SIGKILL")
          } catch {}
        }, 1500)
      }
      const signal = () => stop(new Error("AGY classification interrupted"))
      process.once("SIGTERM", signal)
      process.once("SIGINT", signal)
      const timer = setTimeout(() => stop(new Error("AGY classification timed out")), options.timeoutMs ?? 130000)
      child.on("spawn", async () => {
        try {
          config.childPid = child.pid
          await durableJson(join(runDir, "config.json"), config)
        } catch (error) {
          stop(error)
        }
      })
      child.stdout.setEncoding("utf8")
      child.stdout.on("data", (chunk) => {
        if (stopped) return
        bytes += Buffer.byteLength(chunk)
        if (bytes > 2000000) return stop(new Error("AGY output exceeded limit"))
        pending += chunk
        try {
          let index
          while (pending.includes("\n")) {
            index = pending.indexOf("\n")
            const line = pending.slice(0, index)
            pending = pending.slice(index + 1)
            if (!line.trim()) continue
            const event = JSON.parse(line)
            if (event.event === "init") {
              if (init || event.init?.model !== model || resolve(event.init.cwd) !== runDir) throw new Error("AGY initialization mismatch")
              init = event
            } else if (event.event === "step_update") {
              const step = event.step_update
              if (!["user_input", "agent_response"].includes(step.step_type) && !(step.step_type === "unknown" && step.step_index === 1 && step.state === "DONE")) throw new Error("AGY attempted a forbidden or unknown operation")
            } else if (event.event === "result") {
              if (result) throw new Error("Duplicate AGY result")
              result = event.result
            } else {
              throw new Error("Unknown AGY event")
            }
          }
        } catch (error) {
          stop(error)
        }
      })
      child.stderr.resume()
      child.on("error", (error) => {
        stopped = error
      })
      child.on("close", (code) => {
        clearTimeout(timer)
        clearTimeout(killTimer)
        process.removeListener("SIGTERM", signal)
        process.removeListener("SIGINT", signal)
        if (stopped || code !== 0 || !init || result?.status !== "SUCCESS" || result.conversation_id !== init.conversation_id || !result.response?.trim()) reject(stopped ?? new Error("AGY did not complete classification"))
        else accept({ init, result })
      })
    })
    const owned = await jsonFile(join(runDir, "owned.json"))
    if (!delivered || owned.id !== outcome.init.conversation_id || owned.nonce !== config.nonce) throw new Error("AGY hook did not establish ownership")
    try {
      await readFile(join(runDir, "blocked.json"))
      throw new Error("AGY tool request was blocked")
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  } catch (error) {
    failure = error
  }
  if (server) await new Promise(accept => server.close(accept))
  // A cleanup failure deliberately overrides success and keeps the durable recovery record.
  await cleanupSession(runDir)
  if (failure) throw failure
  onUsage(outcome.result.usage)
  return { choices: [{ message: { content: outcome.result.response } }], antigravity: { model, sessionId: outcome.init.conversation_id, cleaned: true } }
}
