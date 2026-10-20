// Usage statistics per person and team (requirement 19) from the local audit log: tasks, tokens, tool calls,
// approved and rejected changes. Time saved is not measurable; it is shown only as a configured estimate.
import type { AuditRecord } from "./audit.ts"

export type UsageOptions = {
  readonly from?: string
  readonly to?: string
  readonly team?: string
  /** Estimated minutes saved per finished task / per approved change (config `usage`). */
  readonly minutesPerTask?: number
  readonly minutesPerAcceptedChange?: number
}

export type UsageRow = {
  tasks: number
  sessions: number
  toolCalls: number
  acceptedChanges: number
  rejectedChanges: number
  tokens: { input: number; output: number; reasoning: number; cache: number; total: number }
  /** Estimated minutes saved, or null when no estimate is configured. */
  estimatedMinutesSaved: number | null
}

export type UsageReport = {
  readonly period: { from: string | null; to: string | null }
  readonly estimate: { minutesPerTask: number | null; minutesPerAcceptedChange: number | null }
  readonly total: UsageRow
  readonly byUser: Record<string, UsageRow & { team: string | null }>
  readonly byTeam: Record<string, UsageRow & { users: number }>
  readonly byMode: Record<string, UsageRow>
  readonly byDay: Record<string, UsageRow>
}

type Acc = Omit<UsageRow, "sessions" | "estimatedMinutesSaved"> & { sessions: Set<string>; users: Set<string> }

const empty = (): Acc => ({
  tasks: 0,
  sessions: new Set(),
  users: new Set(),
  toolCalls: 0,
  acceptedChanges: 0,
  rejectedChanges: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: 0, total: 0 },
})

/** Actions that change something: edits, commands, MCP and mainframe calls. Reads are not "changes". */
const CHANGE = /^(edit|shell|browser|webfetch|a2a|[a-z0-9-]+_.+)$/

export function usageReport(records: readonly AuditRecord[], options: UsageOptions = {}): UsageReport {
  const total = empty()
  const users = new Map<string, Acc & { team?: string }>()
  const teams = new Map<string, Acc>()
  const modes = new Map<string, Acc>()
  const days = new Map<string, Acc>()
  const bucket = <K>(map: Map<K, Acc>, key: K) => {
    let acc = map.get(key)
    if (!acc) map.set(key, (acc = empty()))
    return acc
  }
  for (const r of records) {
    const a = r.attributes
    if (options.team && a["bobi.team"] !== options.team) continue
    const user = bucket(users, a["bobi.user"]) as Acc & { team?: string }
    if (a["bobi.team"]) user.team = a["bobi.team"]
    const targets = [total, user, bucket(teams, a["bobi.team"] ?? "(no team)"), bucket(modes, a["bobi.mode"]), bucket(days, new Date(r.start).toISOString().slice(0, 10))]
    for (const acc of targets) {
      acc.sessions.add(a["bobi.session"])
      acc.users.add(a["bobi.user"])
      if (r.name === "bobi.task") acc.tasks++
      else if (r.name === "bobi.tool") acc.toolCalls++
      else if (r.name === "bobi.usage") {
        const t = { input: a["bobi.tokens.input"] ?? 0, output: a["bobi.tokens.output"] ?? 0, reasoning: a["bobi.tokens.reasoning"] ?? 0, cache: a["bobi.tokens.cache"] ?? 0 }
        acc.tokens.input += t.input
        acc.tokens.output += t.output
        acc.tokens.reasoning += t.reasoning
        acc.tokens.cache += t.cache
        acc.tokens.total += t.input + t.output + t.reasoning + t.cache
      } else if (r.name === "bobi.approval" && CHANGE.test(a["bobi.action"] ?? "")) {
        if (a["bobi.result"] === "reject") acc.rejectedChanges++
        else acc.acceptedChanges++
      }
    }
  }
  const mpt = options.minutesPerTask ?? null
  const mpc = options.minutesPerAcceptedChange ?? null
  const row = (acc: Acc): UsageRow => ({
    tasks: acc.tasks,
    sessions: acc.sessions.size,
    toolCalls: acc.toolCalls,
    acceptedChanges: acc.acceptedChanges,
    rejectedChanges: acc.rejectedChanges,
    tokens: { ...acc.tokens },
    estimatedMinutesSaved: mpt === null && mpc === null ? null : Math.round((mpt ?? 0) * acc.tasks + (mpc ?? 0) * acc.acceptedChanges),
  })
  const sorted = <V>(map: Map<string, V>) => [...map].sort(([a], [b]) => a.localeCompare(b))
  return {
    period: { from: options.from ?? null, to: options.to ?? null },
    estimate: { minutesPerTask: mpt, minutesPerAcceptedChange: mpc },
    total: row(total),
    byUser: Object.fromEntries(sorted(users).map(([k, v]) => [k, { ...row(v), team: v.team ?? null }])),
    byTeam: Object.fromEntries(sorted(teams).map(([k, v]) => [k, { ...row(v), users: v.users.size }])),
    byMode: Object.fromEntries(sorted(modes).map(([k, v]) => [k, row(v)])),
    byDay: Object.fromEntries(sorted(days).map(([k, v]) => [k, row(v)])),
  }
}

const n = (v: number) => v.toLocaleString("en-US")
const hours = (minutes: number | null) => (minutes === null ? "–" : `${(minutes / 60).toFixed(1)} h`)
const cells = (r: UsageRow) => [r.tasks, r.sessions, n(r.tokens.input), n(r.tokens.output), n(r.tokens.total), r.toolCalls, r.acceptedChanges, r.rejectedChanges, hours(r.estimatedMinutesSaved)]
const HEAD = ["Tasks", "Sessions", "Input tokens", "Output tokens", "Total tokens", "Tool calls", "Approved changes", "Rejected", "Time saved (est.)"]
const table = (first: string, rows: [string, UsageRow][]) =>
  rows.length === 0
    ? "_none_\n"
    : [`| ${[first, ...HEAD].join(" | ")} |`, `|${[first, ...HEAD].map(() => "---").join("|")}|`, ...rows.map(([k, r]) => `| ${[k.replace(/\|/g, "\\|"), ...cells(r)].join(" | ")} |`)].join("\n") + "\n"

export function renderUsageReport(report: UsageReport): string {
  const period = report.period.from || report.period.to ? `${report.period.from ?? "start"} – ${report.period.to ?? "today"}` : "all records"
  const e = report.estimate
  const estimate =
    e.minutesPerTask === null && e.minutesPerAcceptedChange === null
      ? "Time saved is not shown: set `usage.minutesPerTask` and/or `usage.minutesPerAcceptedChange` in the Bobi config to estimate it."
      : `Time saved is an **estimate**, not a measurement: ${e.minutesPerTask ?? 0} min per task + ${e.minutesPerAcceptedChange ?? 0} min per approved change (config \`usage\`).`
  return [
    "# Bobi usage report",
    "",
    `Period: ${period} (UTC). Source: local audit log.`,
    "",
    estimate,
    "",
    "## Total",
    "",
    table("", [["all", report.total]]),
    "## Teams",
    "",
    table("Team", Object.entries(report.byTeam)),
    "## People",
    "",
    table("Person", Object.entries(report.byUser).map(([k, v]) => [v.team ? `${k} (${v.team})` : k, v])),
    "## Modes",
    "",
    table("Mode", Object.entries(report.byMode)),
    "## Days",
    "",
    table("Day", Object.entries(report.byDay)),
  ].join("\n")
}
