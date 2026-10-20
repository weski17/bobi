import { expect, test } from "bun:test"
import { renderUsageReport, usageReport, type AuditRecord } from "../src/index.ts"

const day1 = Date.parse("2026-10-19T09:00:00Z")
const day2 = Date.parse("2026-10-20T09:00:00Z")
const rec = (name: AuditRecord["name"], attributes: Partial<AuditRecord["attributes"]>, start = day1): AuditRecord => ({
  name,
  start,
  end: start,
  attributes: { "bobi.user": "anna", "bobi.team": "payments", "bobi.mode": "code", "bobi.session": "s1", "bobi.result": "recorded", ...attributes } as AuditRecord["attributes"],
})
const tokens = (input: number, output: number) => ({ "bobi.tokens.input": input, "bobi.tokens.output": output, "bobi.tokens.reasoning": 1, "bobi.tokens.cache": 2 })

const records = [
  rec("bobi.task", { "bobi.result": "started" }),
  rec("bobi.usage", tokens(100, 20)),
  rec("bobi.usage", tokens(50, 10)),
  rec("bobi.tool", { "bobi.tool": "edit", "bobi.result": "completed" }),
  rec("bobi.approval", { "bobi.action": "edit", "bobi.result": "once" }),
  rec("bobi.approval", { "bobi.action": "zowe_submit_job", "bobi.result": "always" }),
  rec("bobi.approval", { "bobi.action": "shell", "bobi.result": "reject" }),
  rec("bobi.approval", { "bobi.action": "read", "bobi.result": "once" }),
  rec("bobi.task", { "bobi.user": "ben", "bobi.team": undefined, "bobi.mode": "ask", "bobi.session": "s2", "bobi.result": "started" }, day2),
  rec("bobi.usage", { ...tokens(10, 5), "bobi.user": "ben", "bobi.team": undefined, "bobi.mode": "ask", "bobi.session": "s2" }, day2),
  rec("bobi.usage", { "bobi.user": "ben", "bobi.team": undefined, "bobi.session": "s2" }, day2),
]

test("counts tasks, tokens, tool calls and approved/rejected changes per person, team, mode and day", () => {
  const report = usageReport(records)
  expect(report.total).toEqual({
    tasks: 2,
    sessions: 2,
    toolCalls: 1,
    acceptedChanges: 2,
    rejectedChanges: 1,
    tokens: { input: 160, output: 35, reasoning: 3, cache: 6, total: 204 },
    estimatedMinutesSaved: null,
  })
  expect(report.byUser.anna).toMatchObject({ team: "payments", tasks: 1, tokens: { total: 186 } })
  expect(report.byUser.ben).toMatchObject({ team: null, tasks: 1 })
  expect(report.byTeam.payments).toMatchObject({ users: 1, acceptedChanges: 2 })
  expect(report.byTeam["(no team)"]).toMatchObject({ users: 1 })
  expect(Object.keys(report.byMode)).toEqual(["ask", "code"])
  expect(Object.keys(report.byDay)).toEqual(["2026-10-19", "2026-10-20"])
})

test("time saved only as a configured estimate; team filter", () => {
  const report = usageReport(records, { minutesPerTask: 15, minutesPerAcceptedChange: 5, team: "payments", from: "2026-10-19" })
  expect(report.total).toMatchObject({ tasks: 1, estimatedMinutesSaved: 25 })
  expect(Object.keys(report.byUser)).toEqual(["anna"])
  expect(usageReport(records, { minutesPerTask: 30 }).total.estimatedMinutesSaved).toBe(60)
  const md = renderUsageReport(report)
  expect(md).toContain("Period: 2026-10-19 – today")
  expect(md).toContain("**estimate**")
  expect(md).toContain("| anna (payments) | 1 | 1 | 150 | 30 | 186 | 1 | 2 | 1 | 0.4 h |")
  const plain = renderUsageReport(usageReport(records))
  expect(plain).toContain("Time saved is not shown")
  expect(plain).toContain("| ben | 1 | 1 | 10 | 5 | 18 | 0 | 0 | 0 | – |")
  expect(renderUsageReport(usageReport([]))).toContain("_none_")
})
