import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ESLint } from "eslint"
import { react } from "@ourongxing/eslint-config"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

const eslint = new ESLint()
const filePath = "src/components/attachment-preview/index.tsx"
const probeRoot = join("src", "eslint-config-probe")
const probes = new Map<string, string>()
const migrations = [
  ["react-dom/no-children-in-void-dom-elements", "react-dom/no-void-elements-with-children", "export const Probe = () => <img>child</img>"],
  ["react/ensure-forward-ref-using-ref", "react/no-useless-forward-ref", "import { forwardRef } from 'react'; export const Probe = forwardRef(() => <div />)"],
  ["react/no-comment-textnodes", "react/jsx-no-comment-textnodes", "export const Probe = () => <div>// comment</div>"],
  ["react/no-nested-components", "react/no-nested-component-definitions", "export function Probe() { function Child() { return <div /> } return <Child /> }"],
  ["react/prefer-shorthand-boolean", "react/jsx-shorthand-boolean", "export const Probe = () => <input disabled={true} />"],
  ["react/prefer-shorthand-fragment", "react/jsx-shorthand-fragment", "import { Fragment } from 'react'; export const Probe = () => <Fragment><div /><div /></Fragment>"],
] as const
const extraProbes = {
  hooks: "import { useState } from 'react'; export function Probe({ active }) { if (active) useState(0); return <div dangerouslySetInnerHTML={{ __html: 'text' }}>child</div> }",
  valid: "export function Probe() {\n  return <div />\n}\n",
} as const

function writeProbe(name: string, code: string) {
  const directory = mkdtempSync(join(probeRoot, `${name.replaceAll("/", "-")}-`))
  const probePath = join(directory, "probe.tsx")
  writeFileSync(probePath, code.endsWith("\n") ? code : `${code}\n`)
  probes.set(name, probePath)
}

async function lintProbe(name: string) {
  const probePath = probes.get(name)
  if (!probePath) throw new Error(`missing probe ${name}`)
  const [result] = await eslint.lintFiles(probePath)
  return result
}

describe("react preset compatibility", () => {
  beforeAll(() => {
    mkdirSync(probeRoot, { recursive: true })
    for (const [oldName, , code] of migrations) writeProbe(oldName, code)
    for (const [name, code] of Object.entries(extraProbes)) writeProbe(name, code)
  })

  afterAll(() => {
    rmSync(probeRoot, { recursive: true, force: true })
  })

  it("preserves every preset rule's severity and options", async () => {
    const preset = await react({ files: ["src/**"] })
    const original = preset.find(config => config.name === "antfu/react/rules")!.rules!
    const effective = await eslint.calculateConfigForFile(filePath)
    const renames = Object.fromEntries(migrations.map(([oldName, newName]) => [oldName, newName]))
    const levels = { off: 0, warn: 1, error: 2 }
    for (const [name, value] of Object.entries(original)) {
      const [level, ...options] = Array.isArray(value) ? value : [value]
      expect(effective.rules[renames[name] ?? name].slice(0, 1 + options.length)).toEqual([
        typeof level === "string" ? levels[level as keyof typeof levels] : level,
        ...options,
      ])
      if (renames[name]) expect(effective.rules[name]).toBeUndefined()
    }
  })

  it.each(migrations)("enforces migrated %s as %s", async (oldName, newName) => {
    const result = await lintProbe(oldName)
    expect(result.fatalErrorCount).toBe(0)
    expect(result.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ ruleId: newName, severity: 1 }),
    ]))
  })

  it("keeps Hooks and dangerous HTML checks at error level", async () => {
    const result = await lintProbe("hooks")
    for (const ruleId of ["react-hooks/rules-of-hooks", "react-dom/no-dangerously-set-innerhtml-with-children"]) {
      expect(result.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({ ruleId, severity: 2 }),
      ]))
    }
  })

  it("accepts valid TSX with type-aware rules enabled", async () => {
    const result = await lintProbe("valid")
    expect(result.messages).toEqual([])
  })
})
