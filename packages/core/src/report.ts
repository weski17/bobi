// Audit and compliance report (requirement 18) from the local audit log: who did what, in which mode, with
// which tool, what was asked, approved, rejected or denied, and which actions reached outside the project.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import type { AuditRecord } from "./audit.ts"

export type ReportOptions = {
  /** Inclusive start / end day (YYYY-MM-DD, UTC). */
  readonly from?: string
  readonly to?: string
  readonly user?: string
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Reads <dir>/<YYYY-MM-DD>.jsonl files in the period; malformed lines are counted, not fatal. */
export function readAuditLog(dir: string, options: ReportOptions = {}): { records: AuditRecord[]; skipped: number; files: string[] } {
  for (const day of [options.from, options.to]) if (day !== undefined && !DAY.test(day)) throw new Error(`"${day}" is not a date (YYYY-MM-DD)`)
  if (!existsSync(dir)) return { records: [], skipped: 0, files: [] }
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .filter((f) => (!options.from || f.slice(0, 10) >= options.from) && (!options.to || f.slice(0, 10) <= options.to))
    .sort()
  const records: AuditRecord[] = []
  let skipped = 0
  for (const file of files)
    for (const line of readFileSync(path.join(dir, file), "utf8").split("\n")) {
      if (!line.trim()) continue
      try {
        const record = JSON.parse(line) as AuditRecord
        if (typeof record.name !== "string" || typeof record.attributes !== "object") throw new Error("not a record")
        if (options.user && record.attributes["bobi.user"] !== options.user) continue
        records.push(record)
      } catch {
        skipped++
      }
    }
  return { records, skipped, files }
}

type Count = Record<string, number>
const inc = (map: Count, key: string, by = 1) => void (map[key] = (map[key] ?? 0) + by)

export type AuditReport = {
  readonly period: { from: string | null; to: string | null }
  readonly totals: { records: number; sessions: number; users: number; toolCalls: number; toolErrors: number; skippedLines: number }
  readonly byUser: Record<string, { sessions: number; toolCalls: number; approvals: number; rejections: number; denied: number }>
  readonly byMode: Count
  readonly byTool: Record<string, { calls: number; errors: number }>
  readonly permissions: Record<string, Count>
  readonly approvals: Count
  /** Actions that leave the project or change something outside it (shell, network, MCP, mainframe). */
  readonly external: { time: string; user: string; mode: string; action: string; resources: string; result: string }[]
  readonly rejected: { time: string; user: string; mode: string; action: string; resources: string; result: string }[]
}

const EXTERNAL = /^(shell|webfetch|websearch|browser|external_directory|[a-z0-9-]+_.+)$/

export function auditReport(records: readonly AuditRecord[], options: ReportOptions & { skipped?: number } = {}): AuditReport {
  const sessions = new Set<string>()
  const users = new Map<string, { sessions: Set<string>; toolCalls: number; approvals: number; rejections: number; denied: number }>()
  const byMode: Count = {}
  const byTool: AuditReport["byTool"] = {}
  const permissions: AuditReport["permissions"] = {}
  const approvals: Count = {}
  const external: AuditReport["external"] = []
  const rejected: AuditReport["rejected"] = []
  let toolCalls = 0
  let toolErrors = 0
  for (const r of [...records].sort((a, b) => a.start - b.start)) {
    const a = r.attributes
    const user = users.get(a["bobi.user"]) ?? { sessions: new Set(), toolCalls: 0, approvals: 0, rejections: 0, denied: 0 }
    users.set(a["bobi.user"], user)
    sessions.add(a["bobi.session"])
    user.sessions.add(a["bobi.session"])
    const row = { time: new Date(r.start).toISOString(), user: a["bobi.user"], mode: a["bobi.mode"], action: a["bobi.action"] ?? a["bobi.tool"] ?? "", resources: a["bobi.resources"] ?? "", result: a["bobi.result"] }
    if (r.name === "bobi.tool") {
      toolCalls++
      user.toolCalls++
      inc(byMode, a["bobi.mode"])
      const tool = (byTool[a["bobi.tool"] ?? "?"] ??= { calls: 0, errors: 0 })
      tool.calls++
      if (a["bobi.result"] === "error") {
        toolErrors++
        tool.errors++
      }
    } else if (r.name === "bobi.permission") {
      inc((permissions[a["bobi.action"] ?? "?"] ??= {}), a["bobi.result"])
      if (a["bobi.result"] === "deny") {
        user.denied++
        rejected.push(row)
      }
      if (EXTERNAL.test(a["bobi.action"] ?? "") && a["bobi.result"] !== "deny" && !["read", "glob", "grep"].includes(a["bobi.action"] ?? "")) external.push(row)
    } else if (r.name === "bobi.approval") {
      inc(approvals, a["bobi.result"])
      if (a["bobi.result"] === "reject") {
        user.rejections++
        rejected.push(row)
      } else user.approvals++
    }
  }
  return {
    period: { from: options.from ?? null, to: options.to ?? null },
    totals: { records: records.length, sessions: sessions.size, users: users.size, toolCalls, toolErrors, skippedLines: options.skipped ?? 0 },
    byUser: Object.fromEntries([...users].map(([name, u]) => [name, { sessions: u.sessions.size, toolCalls: u.toolCalls, approvals: u.approvals, rejections: u.rejections, denied: u.denied }])),
    byMode,
    byTool,
    permissions,
    approvals,
    external,
    rejected,
  }
}

const cell = (v: unknown) => String(v).replace(/\|/g, "\\|").replace(/\n/g, " ")
const table = (head: string[], rows: unknown[][]) =>
  rows.length === 0 ? "_none_\n" : [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`)].join("\n") + "\n"

export function renderAuditReport(report: AuditReport, limit = 200): string {
  const period = report.period.from || report.period.to ? `${report.period.from ?? "start"} – ${report.period.to ?? "today"}` : "all records"
  const t = report.totals
  const sorted = (c: Count) => Object.entries(c).sort((a, b) => b[1] - a[1])
  const lines = [
    `# Bobi audit report`,
    "",
    `Period: ${period} (UTC). Source: local audit log; secrets are masked at recording time.`,
    "",
    "## Summary",
    "",
    table(["Users", "Sessions", "Tool calls", "Tool errors", "Approved", "Rejected", "Denied by policy"], [
      [t.users, t.sessions, t.toolCalls, t.toolErrors, (report.approvals.once ?? 0) + (report.approvals.always ?? 0), report.approvals.reject ?? 0, Object.values(report.permissions).reduce((n, c) => n + (c.deny ?? 0), 0)],
    ]),
    ...(t.skippedLines ? [`> ${t.skippedLines} unreadable line(s) in the audit log were skipped.`, ""] : []),
    "## Users",
    "",
    table(["User", "Sessions", "Tool calls", "Approvals", "Rejections", "Denied"], Object.entries(report.byUser).map(([u, v]) => [u, v.sessions, v.toolCalls, v.approvals, v.rejections, v.denied])),
    "## Modes",
    "",
    table(["Mode", "Tool calls"], sorted(report.byMode)),
    "## Tools",
    "",
    table(["Tool", "Calls", "Errors"], Object.entries(report.byTool).sort((a, b) => b[1].calls - a[1].calls).map(([k, v]) => [k, v.calls, v.errors])),
    "## Permission decisions (policy)",
    "",
    table(["Action", "allow", "ask", "deny"], Object.entries(report.permissions).map(([k, v]) => [k, v.allow ?? 0, v.ask ?? 0, v.deny ?? 0])),
    "## User answers to approval requests",
    "",
    table(["Answer", "Count"], sorted(report.approvals)),
    "## Actions outside the project (terminal, network, MCP, mainframe)",
    "",
    table(["Time", "User", "Mode", "Action", "Resource", "Policy"], report.external.slice(0, limit).map((r) => [r.time, r.user, r.mode, r.action, r.resources, r.result])),
    ...(report.external.length > limit ? [`_${report.external.length - limit} more not shown._`, ""] : []),
    "## Rejected and denied actions",
    "",
    table(["Time", "User", "Mode", "Action", "Resource", "Result"], report.rejected.slice(0, limit).map((r) => [r.time, r.user, r.mode, r.action, r.resources, r.result])),
    ...(report.rejected.length > limit ? [`_${report.rejected.length - limit} more not shown._`, ""] : []),
  ]
  return lines.join("\n")
}
