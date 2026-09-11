import { describe, it } from "vitest"
import { sourceAdminContractCases } from "./fixtures/source-admin-contract-cases"

describe("source configuration atomic lifecycle", () => {
  for (const test of sourceAdminContractCases) it(test.name, test.run)
})
