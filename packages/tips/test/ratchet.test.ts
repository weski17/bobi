import { expect, test } from "bun:test"
import { newTips, ratchet } from "../src/index.ts"

const branchy = (name: string, n = 12) => `export function ${name}(x: number) {\n${Array.from({ length: n }, (_, i) => `  if (x === ${i}) return ${i}`).join("\n")}\n  return -1\n}\n`
const simple = "export const one = 1\n"

test("a new complex function in a new file is a new tip", () => {
  const tips = newTips("a.ts", undefined, branchy("decide"))
  expect(tips.map((t) => [t.rule, t.symbol])).toEqual([["complexity", "decide"]])
})

test("an existing finding that stays is not reported, even when its lines move", () => {
  const before = branchy("decide")
  expect(newTips("a.ts", before, `// header\n// more\n${before}`)).toEqual([])
})

test("a second complex function is reported, the old one is not", () => {
  const before = branchy("old")
  const tips = newTips("a.ts", before, `${before}\n${branchy("fresh")}`)
  expect(tips.map((t) => t.symbol)).toEqual(["fresh"])
})

test("fixing a finding or leaving a file clean reports nothing", () => {
  expect(newTips("a.ts", branchy("decide"), simple)).toEqual([])
  expect(newTips("a.ts", simple, `${simple}export const two = 2\n`)).toEqual([])
})

test("unsupported files give nothing; ratchet lists only files with new tips", () => {
  expect(newTips("notes.md", undefined, branchy("x"))).toEqual([])
  const result = ratchet([
    { file: "clean.ts", before: simple, after: `${simple}export const x = 3\n` },
    { file: "worse.ts", before: simple, after: branchy("big") },
  ])
  expect(result.map((r) => r.file)).toEqual(["worse.ts"])
})

test("project limits apply", () => {
  expect(newTips("a.ts", undefined, branchy("decide"), { complexity: 50 })).toEqual([])
})
