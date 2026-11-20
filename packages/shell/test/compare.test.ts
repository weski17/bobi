import { expect, test } from "bun:test"
import type { AuditRecord } from "@bobi/core"
import { compareModels, renderComparison, summarizeRecords, type CompareDeps } from "../src/compare.ts"

const rec = (name: AuditRecord["name"], a: Record<string, string | number>, start = 1000): AuditRecord =>
  ({ name, start, end: start, attributes: { "bobi.user": "u", "bobi.mode": "code", "bobi.session": "s", "bobi.result": "completed", ...a } }) as AuditRecord

test("summarizeRecords counts tool calls, failures, refusals and tokens", () => {
  expect(
    summarizeRecords([
      rec("bobi.tool", {}),
      rec("bobi.tool", { "bobi.result": "error" }),
      rec("bobi.approval", { "bobi.result": "reject" }),
      rec("bobi.approval", { "bobi.result": "once" }),
      rec("bobi.usage", { "bobi.tokens.input": 10, "bobi.tokens.output": 4 }),
      rec("bobi.usage", { "bobi.tokens.input": 5, "bobi.tokens.output": 1 }),
    ]),
  ).toEqual({ toolCalls: 2, toolErrors: 1, rejected: 1, tokens: { input: 15, output: 5 } })
})

function deps(overrides: Partial<CompareDeps> = {}) {
  const log: string[] = []
  let clock = 0
  const value: CompareDeps = {
    worktree: (i) => (log.push(`worktree ${i}`), `/w${i}`),
    runAgent: async (dir, model) => (log.push(`run ${model} in ${dir}`), (clock += 2500), model === "bad" ? 1 : 0),
    changes: (dir) => (dir === "/w0" ? { diff: "d0", files: 2, added: 10, removed: 1 } : { diff: "d1", files: 1, added: 3, removed: 0 }),
    runTest: (dir) => ({ exit: dir === "/w2" ? 1 : 0, seconds: 1.5, tail: "boom" }),
    confirmTest: async () => true,
    records: () => [rec("bobi.tool", {}), rec("bobi.usage", { "bobi.tokens.input": 7, "bobi.tokens.output": 3 })],
    cleanup: (dir) => void log.push(`cleanup ${dir}`),
    now: () => clock,
    ...overrides,
  }
  return { value, log }
}

test("models run one after another, each in its own worktree that is cleaned up", async () => {
  const { value, log } = deps()
  const results = await compareModels({ task: "t", models: ["a", "b"], mode: "code", test: "bun test" }, value)
  expect(log).toEqual(["worktree 0", "run a in /w0", "cleanup /w0", "worktree 1", "run b in /w1", "cleanup /w1"])
  expect(results.map((r) => [r.model, r.completed, r.files, r.added, r.seconds, r.tokens.input, r.test?.exit])).toEqual([
    ["a", true, 2, 10, 2.5, 7, 0],
    ["b", true, 1, 3, 2.5, 7, 0],
  ])
})

test("a worktree is cleaned up even when the run throws", async () => {
  const { value, log } = deps({ runAgent: async () => { throw new Error("server down") } })
  await expect(compareModels({ task: "t", models: ["a", "b"], mode: "code" }, value)).rejects.toThrow("server down")
  expect(log).toEqual(["worktree 0", "cleanup /w0"])
})

test("without a test command no test runs", async () => {
  const { value } = deps({ runTest: () => { throw new Error("must not run") } })
  const results = await compareModels({ task: "t", models: ["a", "b"], mode: "code" }, value)
  expect(results[0]!.test).toBeUndefined()
})

test("the table names who passed, the smallest change, failures and refusals", async () => {
  const { value } = deps({ runTest: (dir) => ({ exit: dir === "/w1" ? 2 : 0, seconds: 1, tail: "assertion failed" }), records: () => [rec("bobi.approval", { "bobi.result": "reject" })] })
  const options = { task: "fix rounding", models: ["a", "b"], mode: "code", test: "bun test" }
  const text = renderComparison(options, await compareModels(options, value))
  expect(text).toContain("| a | completed | passed | 2.5s | 2 | +10/-1 |")
  expect(text).toContain("| b | completed | failed (exit 2) |")
  expect(text).toContain("Passed the tests: a. Smallest change among them: a (+10/-1).")
  expect(text).toContain("refused: a 1×, b 1×")
  expect(text).toContain("### b: test output (end)")
  expect(text).toContain("assertion failed")
  expect(text).toContain("anecdote")
})

test("no model passing is said plainly; a failed run is marked", async () => {
  const { value } = deps({ runAgent: async () => 1, runTest: () => ({ exit: 1, seconds: 1, tail: "x" }) })
  const options = { task: "t", models: ["a", "bad"], mode: "code", test: "false" }
  const text = renderComparison(options, await compareModels(options, value))
  expect(text).toContain("No model passed the test command.")
  expect(text).toContain("| failed |")
})

test("without a test command only the run is compared", async () => {
  const { value } = deps()
  const options = { task: "t", models: ["a", "b"], mode: "code" }
  const text = renderComparison(options, await compareModels(options, value))
  expect(text).toContain("no test command given")
  expect(text).not.toContain("Passed the tests")
})

test("the test command runs only on changes the user confirmed (review 2026-11-19, H4)", async () => {
  const ran: string[] = []
  const asked: string[] = []
  const { value } = deps({
    runTest: (dir) => (ran.push(dir), { exit: 0, seconds: 1, tail: "" }),
    confirmTest: async (model, changes) => (asked.push(`${model}:${changes.diff}`), model === "a"),
  })
  const options = { task: "t", models: ["a", "b"], mode: "code", test: "bun test" }
  const results = await compareModels(options, value)
  expect(asked).toEqual(["a:d0", "b:d1"])
  expect(ran).toEqual(["/w0"])
  expect(results[1]!.test).toMatchObject({ skipped: true })
  const text = renderComparison(options, results)
  expect(text).toContain("not run (not confirmed)")
  expect(text).toContain("Test not run (not confirmed): b")
})
