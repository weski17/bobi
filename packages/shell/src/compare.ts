// Model comparison (ADR-0022): the same task with two or more models, each in its own throw-away git worktree of HEAD,
// then the same test command on each result. Shows which model solved the task on *your* code, how many changes and
// tokens it took and how long it ran. Edits are approved automatically inside the worktrees only (explicit, documented);
// shell commands, network and everything else keep asking, which a headless run cannot answer – so a model cannot run
// commands during a comparison, only edit files. The test command is run by Bobi itself, not by the model.
import type { AuditRecord } from "@bobi/core"

export type CompareOptions = {
  readonly task: string
  readonly models: readonly string[]
  readonly mode: string
  readonly test?: string
}

export type RunResult = {
  readonly model: string
  /** The agent run ended with exit code 0. */
  readonly completed: boolean
  readonly seconds: number
  readonly files: number
  readonly added: number
  readonly removed: number
  readonly toolCalls: number
  readonly toolErrors: number
  readonly rejected: number
  readonly tokens: { input: number; output: number }
  readonly test?: { exit: number; seconds: number; tail: string }
  readonly diff: string
}

export type CompareDeps = {
  /** Creates an isolated worktree of HEAD and returns its path. */
  worktree(index: number): string
  /** Runs the agent in `dir` with `model`; resolves with the exit code. */
  runAgent(dir: string, model: string): Promise<number>
  /** Everything the agent changed in `dir` against HEAD, including new files. */
  changes(dir: string): { diff: string; files: number; added: number; removed: number }
  runTest(dir: string, command: string): { exit: number; seconds: number; tail: string }
  /** Audit records written between the two times (ms). */
  records(from: number, to: number): AuditRecord[]
  cleanup(dir: string): void
  now(): number
}

/** What the audit log says about one run: tool calls, rejected approvals, tokens. */
export function summarizeRecords(records: readonly AuditRecord[]) {
  let toolCalls = 0
  let toolErrors = 0
  let rejected = 0
  let input = 0
  let output = 0
  for (const r of records) {
    const a = r.attributes
    if (r.name === "bobi.tool") {
      toolCalls++
      if (a["bobi.result"] === "error") toolErrors++
    } else if (r.name === "bobi.approval" && a["bobi.result"] === "reject") rejected++
    else if (r.name === "bobi.usage") {
      input += a["bobi.tokens.input"] ?? 0
      output += a["bobi.tokens.output"] ?? 0
    }
  }
  return { toolCalls, toolErrors, rejected, tokens: { input, output } }
}

export async function compareModels(options: CompareOptions, deps: CompareDeps): Promise<RunResult[]> {
  const results: RunResult[] = []
  for (const [index, model] of options.models.entries()) {
    const dir = deps.worktree(index)
    try {
      const began = deps.now()
      const exit = await deps.runAgent(dir, model)
      const ended = deps.now()
      const changes = deps.changes(dir)
      // Models run one after another, so the time window identifies the run.
      const summary = summarizeRecords(deps.records(began, ended + 1000))
      results.push({
        model,
        completed: exit === 0,
        seconds: Math.round((ended - began) / 100) / 10,
        ...changes,
        ...summary,
        ...(options.test ? { test: deps.runTest(dir, options.test) } : {}),
      })
    } finally {
      deps.cleanup(dir)
    }
  }
  return results
}

const cell = (v: string | number) => String(v).replace(/\|/g, "\\|").replace(/\n/g, " ")

export function renderComparison(options: CompareOptions, results: readonly RunResult[]): string {
  const lines = [
    "# Bobi model comparison",
    "",
    `Task: ${options.task}`,
    `Mode: ${options.mode} · every model started from the same commit in its own worktree · ${options.test ? `test: \`${options.test}\`` : "no test command given"}`,
    "",
    "| Model | Run | Test | Time | Files | +/- lines | Tool calls (failed) | Tokens in/out |",
    "|---|---|---|---|---|---|---|---|",
  ]
  for (const r of results)
    lines.push(
      `| ${cell(r.model)} | ${r.completed ? "completed" : "failed"} | ${r.test ? (r.test.exit === 0 ? "passed" : `failed (exit ${r.test.exit})`) : "–"} | ${r.seconds}s | ${r.files} | +${r.added}/-${r.removed} | ${r.toolCalls} (${r.toolErrors}) | ${r.tokens.input}/${r.tokens.output} |`,
    )
  const passed = results.filter((r) => r.test?.exit === 0)
  lines.push("")
  if (options.test) {
    if (passed.length === 0) lines.push("No model passed the test command.")
    else {
      const best = [...passed].sort((a, b) => a.added + a.removed - (b.added + b.removed) || a.seconds - b.seconds)[0]!
      lines.push(`Passed the tests: ${passed.map((r) => r.model).join(", ")}. Smallest change among them: ${best.model} (+${best.added}/-${best.removed}).`)
    }
  }
  const rejected = results.filter((r) => r.rejected > 0)
  if (rejected.length) lines.push(`Not allowed (shell, network, …) and therefore refused: ${rejected.map((r) => `${r.model} ${r.rejected}×`).join(", ")}.`)
  lines.push("", "One run per model is an anecdote, not a benchmark: run the comparison several times before drawing conclusions.")
  for (const r of results) if (r.test && r.test.exit !== 0) lines.push("", `### ${r.model}: test output (end)`, "", "```", r.test.tail.trim(), "```")
  return `${lines.join("\n")}\n`
}
