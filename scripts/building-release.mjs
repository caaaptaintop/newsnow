import { createHmac, randomBytes } from "node:crypto"
import { readFile, writeFile, unlink } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

/** A release must finish preview cleanup before it may promote production. */
export async function releaseBuilding({ env = process.env, fetcher = fetch, execute = execFileSync,
  read = readFile, write = writeFile, remove = unlink, log = console.log } = {}) {
  const token = env.CLOUDFLARE_API_TOKEN, account = env.CLOUDFLARE_ACCOUNT_ID
  const project = "capx-newsnow", production = "https://news.capx-ai.com"
  if (!token || !account || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? "")) throw new Error("Release credentials or commit identity missing")
  const apiRoot = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/pages/projects/${project}`
  const deployToken = randomBytes(32).toString("hex")
  const rateSalt = createHmac("sha256", token).update(`building-relay-v3.1:${account}`).digest("hex")
  const safe = text => String(text).split(deployToken).join("[redacted]").split(rateSalt).join("[redacted]").split(token).join("[redacted]")
  // Redact before logging: runner masking commands themselves must never enter tee artifacts.
  async function api(path = "", method = "GET", body) {
    const r = await fetcher(apiRoot + path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000), redirect: "error" })
    const j = await r.json()
    if (!r.ok || !j.success) throw new Error(`Cloudflare ${method} ${path || "project"}: HTTP ${r.status}; codes ${(j.errors ?? []).map(e => e.code).join(",")}`)
    return j.result
  }
  const run = (bin, args, extra = {}) => {
    try {
      const out = execute(bin, args, { encoding: "utf8", stdio: "pipe", maxBuffer: 16 * 1024 * 1024,
        env: { ...env, ...extra }, timeout: 600000 })
      log(safe(out)); return out
    } catch (error) {
      log(safe(error.stdout ?? "")); log(safe(error.stderr ?? ""))
      throw new Error(`Release command failed: ${bin} ${args[0]}`)
    }
  }
  const cfg = await api(), prod = cfg.deployment_configs.production, preview = cfg.deployment_configs.preview ?? {}
  const database = prod?.d1_databases?.NEWSNOW_DB?.id
  if (!database) throw new Error("Existing NEWSNOW_DB production binding missing; no database will be created automatically")
  const reserved = ["BUILDING_DEPLOY_TOKEN", "BUILDING_DEPLOY_EXPIRES", "BUILDING_RATE_SALT"]
  if (reserved.some(k => preview.env_vars?.[k]) || prod.env_vars?.BUILDING_DEPLOY_TOKEN || prod.env_vars?.BUILDING_DEPLOY_EXPIRES)
    throw new Error("Unexpected deployment-only configuration exists; inspect before proceeding")
  // A project-wide preview binding must not be inherited by an unreviewed automatic build.
  if (cfg.source?.config?.deployments_enabled !== false && cfg.source?.config && cfg.source.config.preview_deployment_setting !== "none")
    throw new Error("Automatic preview deployments must be disabled before trusted migration")
  const originalWrangler = await read("wrangler.toml", "utf8")
  const capture = { articles: [] }, visited = new Set(); let cursor = "", captureVersion
  do {
    if (visited.has(cursor)) throw new Error("Production capture cursor repeated")
    visited.add(cursor)
    const response = await fetcher(`${production}/api/intelligence?topic=building${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal: AbortSignal.timeout(60000), redirect: "error" })
    if (!response.ok) throw new Error(`Cannot preserve production metadata: HTTP ${response.status}`)
    const page = await response.json()
    if (!Array.isArray(page.articles) || (captureVersion !== undefined && page.version !== captureVersion)) throw new Error("Production changed during capture; retry release")
    captureVersion = page.version
    capture.articles.push(...page.articles); cursor = page.nextCursor ?? ""
  } while (cursor)
  await write("/tmp/building-release-capture.json", JSON.stringify(capture), { mode: 0o600 })
  const branch = `building-release-${env.GITHUB_SHA.slice(0, 12)}-${randomBytes(4).toString("hex")}`
  let touched = false, previewDeployment, cleaned = false
  async function cleanup() {
    if (!touched || cleaned) return
    // Only our three variables and our temporary DB binding are restored, never unrelated secrets.
    await api("", "PATCH", { deployment_configs: { preview: {
      env_vars: Object.fromEntries(reserved.map(k => [k, null])),
      d1_databases: { NEWSNOW_DB: preview.d1_databases?.NEWSNOW_DB ?? null },
    } } })
    const after = (await api()).deployment_configs.preview ?? {}
    if (reserved.some(k => after.env_vars?.[k]) || (after.d1_databases?.NEWSNOW_DB?.id ?? null) !== (preview.d1_databases?.NEWSNOW_DB?.id ?? null))
      throw new Error("Preview credentials or production DB binding were not removed")
    for (const [key, value] of Object.entries(preview.env_vars ?? {})) {
      if (after.env_vars?.[key]?.type !== value.type || (value.type === "plain_text" && after.env_vars[key].value !== value.value))
        throw new Error("Unrelated preview variable changed during release")
    }
    // Locate by both branch and commit, including a deployment whose upload response was lost.
    const deployments = await api("/deployments")
    for (const d of deployments) {
      if (d.environment === "preview" && (d.id === previewDeployment ||
          (d.deployment_trigger?.metadata?.branch === branch && d.deployment_trigger?.metadata?.commit_hash === env.GITHUB_SHA)))
        await api(`/deployments/${d.id}?force=true`, "DELETE")
    }
    const remaining = await api("/deployments")
    if (remaining.some(d => d.id === previewDeployment || d.deployment_trigger?.metadata?.branch === branch))
      throw new Error("Trusted migration deployment cleanup not confirmed")
    cleaned = true
  }
  try {
    touched = true
    await api("", "PATCH", { deployment_configs: {
      preview: { env_vars: { BUILDING_DEPLOY_TOKEN: { type: "secret_text", value: deployToken },
        BUILDING_DEPLOY_EXPIRES: { type: "secret_text", value: String(Date.now() + 1200000) },
        BUILDING_RATE_SALT: { type: "secret_text", value: rateSalt } }, d1_databases: { NEWSNOW_DB: { id: database } } },
      production: { env_vars: { BUILDING_RATE_SALT: { type: "secret_text", value: rateSalt } } },
    } })
    run("python", ["-c", `import json,tomllib\nfrom pathlib import Path\np=Path('wrangler.toml')\nc=tomllib.loads(p.read_text())\nc['pages_build_output_dir']='dist/output/public'\nprod=c.get('env',{}).get('production',{})\ndb=prod.get('d1_databases',c.get('d1_databases',[]))\nassert any(d.get('binding')=='NEWSNOW_DB' and d.get('database_id') for d in db),'D1 config missing'\nc.setdefault('env',{}).setdefault('preview',{})['d1_databases']=db\nPath('wrangler.jsonc').write_text(json.dumps(c))\np.unlink()`])
    const args = ["dlx", `wrangler@${env.WRANGLER_VERSION ?? "4.129.0"}`, "pages", "deploy", "dist/output/public"]
    run("pnpm", [...args, "--branch", branch, "--commit-hash", env.GITHUB_SHA])
    const deployments = await api("/deployments")
    const match = deployments.find(d => d.environment === "preview" && d.deployment_trigger?.metadata?.branch === branch && d.deployment_trigger?.metadata?.commit_hash === env.GITHUB_SHA)
    if (!match?.id || !/^https:\/\/[a-z0-9-]+\.capx-newsnow\.pages\.dev$/.test(match.url)) throw new Error("Trusted preview identity not verified")
    previewDeployment = match.id
    run("pnpm", ["exec", "tsx", "scripts/migrate-building.ts"], { BUILDING_RELEASE_URL: match.url, BUILDING_RELEASE_TOKEN: deployToken, BUILDING_CAPTURE_PATH: "/tmp/building-release-capture.json" })
    run("node", ["scripts/building-production-smoke.mjs"], { BUILDING_SMOKE_URL: match.url })
    // Cleanup failure is a release failure. Never promote with a live migration credential.
    await cleanup()
    await remove("wrangler.jsonc")
    await write("wrangler.toml", originalWrangler)
    if (env.BUILDING_PREVIEW_ONLY !== "1") {
      run("pnpm", [...args, "--branch", "main", "--commit-hash", env.GITHUB_SHA])
      run("node", ["scripts/building-production-smoke.mjs"])
    }
    const evidence = { release: "pass", storage: "D1", previewValidated: true, previewCleaned: true,
      productionPromoted: env.BUILDING_PREVIEW_ONLY !== "1", codeIncludesProductionSnapshot: false }
    await write("/tmp/building-release-cleanup.json", JSON.stringify(evidence))
    log(JSON.stringify(evidence))
    return evidence
  } finally {
    try { await cleanup() } finally { await remove("/tmp/building-release-capture.json").catch(() => {}) }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  releaseBuilding().catch(error => { console.error(error.message); process.exitCode = 1 })
}
