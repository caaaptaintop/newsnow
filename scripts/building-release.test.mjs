import assert from "node:assert/strict"
import { it } from "node:test"
import { releaseBuilding } from "./building-release.mjs"

function fixture({ failMigration = false, failDelete = false, previewOnly = false } = {}) {
  const cfg = { deployment_configs: { production: { d1_databases: { NEWSNOW_DB: { id: "existing-db" } }, env_vars: { KEEP: { type: "secret_text", value: "" } } },
    preview: { env_vars: { LABEL: { type: "plain_text", value: "keep" } }, d1_databases: {} } } }
  const deployments = [], calls = [], files = new Map([["wrangler.toml", "original-config"]]), logs = []
  const env = { CLOUDFLARE_API_TOKEN: "operator-secret", CLOUDFLARE_ACCOUNT_ID: "account", GITHUB_SHA: "a".repeat(40), BUILDING_PREVIEW_ONLY: previewOnly ? "1" : "0" }
  const options = { env, log: text => logs.push(text), read: async p => files.get(p), write: async (p, v) => files.set(p, v), remove: async p => files.delete(p),
    fetcher: async (url, opts = {}) => {
      calls.push(["api", opts.method ?? "GET", String(url)])
      if (String(url).startsWith("https://news.capx-ai.com/")) return Response.json({ articles: [{ key: "preserved" }], version: "old" })
      const path = String(url).split("/pages/projects/capx-newsnow")[1]
      if (opts.method === "PATCH") {
        const patch = JSON.parse(opts.body).deployment_configs
        for (const [env, value] of Object.entries(patch)) for (const [field, entries] of Object.entries(value)) {
          const dest = cfg.deployment_configs[env][field] ??= {}
          for (const [k, v] of Object.entries(entries)) v === null ? delete dest[k] : dest[k] = v
        }
      }
      if (opts.method === "DELETE") {
        if (failDelete) return Response.json({ success: false, errors: [{ code: "synthetic" }] }, { status: 503 })
        deployments.splice(0)
      }
      return Response.json({ success: true, result: path === "/deployments" ? deployments : cfg })
    },
    execute: (bin, args) => {
      calls.push(["execute", bin, ...args])
      if (args.includes("scripts/migrate-building.ts") && failMigration) throw new Error("synthetic migration failure")
      if (args.includes("deploy")) {
        const branch = args[args.indexOf("--branch") + 1]
        if (branch !== "main") deployments.push({ id: "preview-id", url: "https://12345678.capx-newsnow.pages.dev", environment: "preview", deployment_trigger: { metadata: { branch, commit_hash: env.GITHUB_SHA } } })
        else {
          assert.equal(deployments.length, 0, "migration deployment deleted before production")
          assert(!cfg.deployment_configs.preview.env_vars.BUILDING_DEPLOY_TOKEN)
          assert(!cfg.deployment_configs.preview.d1_databases.NEWSNOW_DB)
          assert.equal(files.get("wrangler.toml"), "original-config")
        }
      }
      return "command completed"
    } }
  return { options, cfg, files, calls, logs }
}
it("promotes only after migration validation, credential removal and preview deletion", async () => {
  const f = fixture(), result = await releaseBuilding(f.options)
  assert(result.productionPromoted && result.previewCleaned)
  assert(f.calls.some(c => c.includes("main")))
  assert.equal(f.cfg.deployment_configs.preview.env_vars.LABEL.value, "keep")
  assert.equal(f.cfg.deployment_configs.production.env_vars.KEEP.type, "secret_text")
  assert(!f.files.has("/tmp/building-release-capture.json"))
  assert(!f.logs.join("\n").includes("operator-secret"))
})
it("preview-only validation does not activate a production deployment", async () => {
  const f = fixture({ previewOnly: true }), result = await releaseBuilding(f.options)
  assert.equal(result.productionPromoted, false)
  assert.equal(f.calls.some(c => c.includes("main")), false)
})
it("migration failure preserves production and removes transient preview credentials", async () => {
  const f = fixture({ failMigration: true })
  await assert.rejects(releaseBuilding(f.options), /Release command failed/)
  assert(!f.calls.some(c => c.includes("main")))
  assert(!f.cfg.deployment_configs.preview.env_vars.BUILDING_DEPLOY_TOKEN)
  assert(!f.cfg.deployment_configs.preview.d1_databases.NEWSNOW_DB)
})
it("cleanup failure is fatal and can never promote production", async () => {
  const f = fixture({ failDelete: true })
  await assert.rejects(releaseBuilding(f.options), /Cloudflare DELETE/)
  assert(!f.calls.some(c => c.includes("main")))
})
it("refuses to overwrite an existing deployment secret", async () => {
  const f = fixture()
  f.cfg.deployment_configs.preview.env_vars.BUILDING_DEPLOY_TOKEN = { type: "secret_text", value: "" }
  await assert.rejects(releaseBuilding(f.options), /Unexpected deployment-only/)
  assert(!f.calls.some(c => c[1] === "PATCH"))
})
it("refuses production DB binding when automatic preview builds can inherit it", async () => {
  const f = fixture()
  f.cfg.source = { config: { preview_deployment_setting: "all" } }
  await assert.rejects(releaseBuilding(f.options), /Automatic preview/)
  assert(!f.calls.some(c => c[1] === "PATCH"))
})
