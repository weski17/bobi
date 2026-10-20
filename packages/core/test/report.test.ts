import { afterAll, expect, spyOn, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DEFAULTS } from "@bobi/config"
import { auditReport, defaultSink, FileSink, MemorySink, MultiSink, OtlpSink, readAuditLog, renderAuditReport, type AuditRecord } from "../src/index.ts"

const dirs: string[] = []
const temp = () => {
  const d = mkdtempSync(path.join(tmpdir(), "bobi-report-"))
  dirs.push(d)
  return d
}
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

const at = Date.parse("2026-10-19T08:00:00Z")
const rec = (name: AuditRecord["name"], attributes: Partial<AuditRecord["attributes"]>, offset = 0): AuditRecord => ({
  name,
  start: at + offset,
  end: at + offset + 5,
  attributes: { "bobi.user": "anna", "bobi.mode": "code", "bobi.session": "s1", "bobi.result": "completed", ...attributes } as AuditRecord["attributes"],
})

test("FileSink appends JSON lines per UTC day, readable only by the user", async () => {
  const dir = path.join(temp(), "audit")
  let now = new Date("2026-10-19T23:59:00Z")
  const sink = new FileSink(dir, () => now)
  sink.record(rec("bobi.tool", { "bobi.tool": "read" }))
  now = new Date("2026-10-20T00:01:00Z")
  sink.record(rec("bobi.tool", { "bobi.tool": "edit" }))
  await sink.flush()
  expect(readFileSync(path.join(dir, "2026-10-19.jsonl"), "utf8").trim().split("\n")).toHaveLength(1)
  expect(JSON.parse(readFileSync(path.join(dir, "2026-10-20.jsonl"), "utf8")).attributes["bobi.tool"]).toBe("edit")
  expect(statSync(path.join(dir, "2026-10-20.jsonl")).mode & 0o777).toBe(0o600)
  expect(new FileSink(dir).dir).toBe(dir)
})

test("FileSink reports a write failure once and never throws", () => {
  const parent = temp()
  writeFileSync(path.join(parent, "file"), "")
  const log = spyOn(console, "error").mockImplementation(() => {})
  try {
    const sink = new FileSink(path.join(parent, "file", "audit"))
    sink.record(rec("bobi.tool", {}))
    sink.record(rec("bobi.tool", {}))
    expect(log).toHaveBeenCalledTimes(1)
  } finally {
    log.mockRestore()
  }
})

test("MultiSink and defaultSink: OTLP and/or the local log", async () => {
  const a = new MemorySink()
  const b = new MemorySink()
  const multi = new MultiSink([a, b])
  multi.record(rec("bobi.tool", {}))
  await multi.flush()
  expect([a.records.length, b.records.length]).toEqual([1, 1])
  const home = temp()
  expect(defaultSink(DEFAULTS, {}, home)).toBeInstanceOf(FileSink)
  expect(defaultSink({ ...DEFAULTS, telemetry: { auditLog: false } }, {}, home)).toBeInstanceOf(MemorySink)
  const both = defaultSink({ ...DEFAULTS, telemetry: { otlpEndpoint: "http://otel:4318" } }, {}, home) as MultiSink
  expect(both).toBeInstanceOf(MultiSink)
  expect(both.sinks.map((s) => s.constructor)).toEqual([OtlpSink, FileSink])
})

test("readAuditLog filters by period and user and skips broken lines", () => {
  const dir = temp()
  writeFileSync(path.join(dir, "2026-10-18.jsonl"), `${JSON.stringify(rec("bobi.tool", {}))}\n`)
  writeFileSync(path.join(dir, "2026-10-19.jsonl"), [JSON.stringify(rec("bobi.tool", {})), JSON.stringify(rec("bobi.tool", { "bobi.user": "ben" })), "{broken", '{"no":"record"}', ""].join("\n"))
  writeFileSync(path.join(dir, "notes.txt"), "ignored")
  expect(readAuditLog(dir).records).toHaveLength(3)
  const day = readAuditLog(dir, { from: "2026-10-19", to: "2026-10-19", user: "anna" })
  expect(day).toMatchObject({ skipped: 2, files: ["2026-10-19.jsonl"] })
  expect(day.records).toHaveLength(1)
  expect(readAuditLog(path.join(dir, "missing"))).toEqual({ records: [], skipped: 0, files: [] })
  expect(() => readAuditLog(dir, { from: "19.10.2026" })).toThrow("is not a date")
})

test("auditReport counts users, modes, tools, decisions and lists external and rejected actions", () => {
  const records = [
    rec("bobi.permission", { "bobi.action": "edit", "bobi.resources": "src/a.ts", "bobi.result": "ask" }, 1),
    rec("bobi.approval", { "bobi.action": "edit", "bobi.resources": "src/a.ts", "bobi.result": "once" }, 2),
    rec("bobi.tool", { "bobi.tool": "edit" }, 3),
    rec("bobi.permission", { "bobi.action": "shell", "bobi.resources": "rm -rf build | tee x", "bobi.result": "ask" }, 4),
    rec("bobi.approval", { "bobi.action": "shell", "bobi.resources": "rm -rf build | tee x", "bobi.result": "reject" }, 5),
    rec("bobi.permission", { "bobi.action": "zowe_submit_job", "bobi.resources": "*", "bobi.result": "ask", "bobi.mode": "advanced" }, 6),
    rec("bobi.approval", { "bobi.result": "always" }, 7),
    rec("bobi.permission", { "bobi.action": "edit", "bobi.resources": ".bobi/config.jsonc", "bobi.result": "deny", "bobi.user": "ben", "bobi.session": "s2" }, 8),
    rec("bobi.permission", { "bobi.action": "read", "bobi.resources": "README.md", "bobi.result": "allow" }, 9),
    rec("bobi.tool", { "bobi.tool": "zowe_submit_job", "bobi.mode": "advanced", "bobi.result": "error", "bobi.error": "HTTP 500" }, 10),
  ]
  const report = auditReport(records, { from: "2026-10-19", skipped: 1 })
  expect(report.totals).toEqual({ records: 10, sessions: 2, users: 2, toolCalls: 2, toolErrors: 1, skippedLines: 1 })
  expect(report.byUser.anna).toEqual({ sessions: 1, toolCalls: 2, approvals: 2, rejections: 1, denied: 0 })
  expect(report.byUser.ben).toMatchObject({ denied: 1 })
  expect(report.byMode).toEqual({ code: 1, advanced: 1 })
  expect(report.byTool.zowe_submit_job).toEqual({ calls: 1, errors: 1 })
  expect(report.permissions.edit).toEqual({ ask: 1, deny: 1 })
  expect(report.approvals).toEqual({ once: 1, reject: 1, always: 1 })
  expect(report.external.map((e) => e.action)).toEqual(["shell", "zowe_submit_job"])
  expect(report.rejected.map((e) => `${e.action}:${e.result}`)).toEqual(["shell:reject", "edit:deny"])

  const md = renderAuditReport(report)
  expect(md).toContain("Period: 2026-10-19 – today (UTC)")
  expect(md).toContain("| 2 | 2 | 2 | 1 | 2 | 1 | 1 |")
  expect(md).toContain("> 1 unreadable line(s)")
  expect(md).toContain("rm -rf build \\| tee x")
  expect(md).toContain("| zowe_submit_job | 1 | 1 |")
  const limited = renderAuditReport(report, 1)
  expect(limited).toContain("_1 more not shown._")
  const empty = renderAuditReport(auditReport([]))
  expect(empty).toContain("Period: all records")
  expect(empty).toContain("_none_")
})

test("the audit directory is created with owner-only access", () => {
  const dir = path.join(temp(), "a", "audit")
  new FileSink(dir).record(rec("bobi.tool", {}))
  expect(statSync(dir).mode & 0o777).toBe(0o700)
})
