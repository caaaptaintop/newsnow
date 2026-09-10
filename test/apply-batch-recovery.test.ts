import { execFileSync } from "node:child_process"
import { expect, it } from "vitest"

it("runs actual CLI modules with isolated storage, signing identity and transport", () => {
  const output = execFileSync(process.execPath, ["--import", "tsx", "test/fixtures/recovery-integration.mts"], { encoding: "utf8", env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.node.json" } })
  expect(output).toContain("RECOVERY_INTEGRATION_PASS")
})
