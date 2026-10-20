// The COBOL server against AWS CardDemo (vendor/carddemo, Apache-2.0), the project's COBOL test object.
import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import path from "node:path"
import { CobolProject, runTool } from "../src/index.ts"

const ROOT = path.join(import.meta.dir, "..", "..", "..", "vendor", "carddemo")
if (!existsSync(path.join(ROOT, "app"))) throw new Error("vendor/carddemo is missing: git submodule update --init --depth 1 vendor/carddemo")
const project = CobolProject.build(ROOT)
const run = (name: string, args: Record<string, unknown>) => runTool(project, name, args) as any

test("parses every CardDemo program; only system copybooks stay unresolved", () => {
  expect(project.programs.size).toBe(44)
  expect(project.problems).toEqual([])
  const unresolved = new Set([...project.programs.values()].flatMap((p) => p.copies.filter((c) => !c.resolved).map((c) => c.name)))
  for (const name of unresolved) expect(name).toMatch(/^(DFH|CMQ)/)
  for (const p of project.programs.values()) if (p.id !== "COBSWAIT") expect(p.paragraphs.length).toBeGreaterThan(0)
})

test("program outline of a batch program", () => {
  const outline = run("program_outline", { program: "CBACT01C" })
  expect(outline.files.map((f: { name: string; assign: string }) => `${f.name}=${f.assign}`)).toEqual(["ACCTFILE-FILE=ACCTFILE", "OUT-FILE=OUTFILE", "ARRY-FILE=ARRYFILE", "VBRC-FILE=VBRCFILE"])
  expect(outline.copybooks.map((c: { name: string }) => c.name)).toEqual(["CVACT01Y", "CODATECN"])
  expect(outline.calls.map((c: { target: string }) => c.target)).toEqual(["COBDATFT", "CEE3ABD"])
  expect(outline.jobs).toMatchObject([{ job: "READACCT", step: "STEP05" }])
  expect(run("list_programs", { query: "CBACT01C" }).programs[0]).toMatchObject({ kind: "batch", jobs: ["READACCT.STEP05"] })
})

test("online programs: XCTL navigation between screens", () => {
  expect(run("list_programs", { query: "COSGN00C" }).programs[0].kind).toBe("online")
  const callees = run("program_calls", { program: "COSGN00C" }).callees.map((c: { program: string }) => c.program)
  expect(callees).toEqual(["COADM01C", "COMEN01C"])
  const callers = run("program_calls", { program: "COMEN01C", direction: "callers" }).callers.map((c: { program: string }) => c.program)
  expect(callers).toContain("COSGN00C")
})

test("PERFORM graph of CBACT01C", () => {
  const result = run("performs", { program: "CBACT01C", depth: 1 })
  expect(result.callees.map((c: { paragraph: string }) => c.paragraph)).toEqual([
    "0000-ACCTFILE-OPEN", "2000-OUTFILE-OPEN", "3000-ARRFILE-OPEN", "4000-VBRFILE-OPEN", "1000-ACCTFILE-GET-NEXT", "9000-ACCTFILE-CLOSE",
  ])
  const up = run("performs", { program: "CBACT01C", paragraph: "9999-abend-program", direction: "callers" })
  expect(up.callers.map((c: { paragraph: string }) => c.paragraph)).toContain("1000-ACCTFILE-GET-NEXT")
})

test("data flow: account fields copied into the output records", () => {
  const down = run("data_flow", { program: "CBACT01C", field: "ACCT-ID OF ACCOUNT-RECORD", depth: 1 })
  expect(down.downstream.map((s: { field: string }) => s.field)).toEqual(["OUT-ACCT-ID", "ARR-ACCT-ID", "VB1-ACCT-ID", "VB2-ACCT-ID"])
  const up = run("data_flow", { program: "CBACT01C", field: "OUT-ACCT-REISSUE-DATE", direction: "upstream", depth: 2 })
  expect(up.upstream.map((s: { field: string }) => s.field)).toContain("CODATECN-0UT-DATE")
  const field = run("field", { program: "COSGN00C", field: "WS-USER-ID" })
  expect(field.from).toMatchObject([{ field: "USERIDI", verb: "MOVE" }])
  expect(field.usedIn.map((u: { paragraph: string }) => u.paragraph)).toEqual(["PROCESS-ENTER-KEY", "READ-USER-SEC-FILE"])
})

test("impact of the account record copybook and of one of its fields", () => {
  const copybook = run("impact", { copybook: "cvact01y.cpy" })
  const programs = copybook.programs.map((p: { program: string }) => p.program)
  expect(programs).toEqual(expect.arrayContaining(["CBACT01C", "CBACT04C", "COACTUPC", "COACTVWC", "COBIL00C"]))
  expect(copybook.programs.every((p: { fields: number }) => p.fields === 14)).toBe(true)
  expect(copybook.jobs).toContain("READACCT.STEP05 (app/jcl/READACCT.jcl)")
  const field = run("impact", { program: "CBACT01C", field: "ACCT-CURR-BAL" })
  expect(field.target).toMatchObject({ copybook: "CVACT01Y", definedIn: "app/cpy/CVACT01Y.cpy" })
  expect(field.programs.find((p: { program: string }) => p.program === "CBACT01C").downstreamFields).toContain("OUT-ACCT-CURR-BAL")
  expect(field.programs.map((p: { program: string }) => p.program)).toContain("COBIL00C")
})

test("impact of a program and of a dataset", () => {
  const program = run("impact", { program: "COMEN01C" })
  expect(program.callers.map((c: { program: string }) => c.program)).toContain("COSGN00C")
  expect(program.sharedCopybooks.find((c: { copybook: string }) => c.copybook === "COCOM01Y").alsoUsedBy.length).toBeGreaterThan(5)
  const dataset = run("impact", { dataset: "AWS.M2.CARDDEMO.ACCTDATA.*" })
  expect(dataset.steps.map((s: { job: string }) => s.job)).toContain("READACCT")
  expect(dataset.programs).toContainEqual(expect.objectContaining({ program: "CBACT04C", file: "ACCOUNT-FILE", dd: "ACCTFILE" }))
})

test("find and diagrams", () => {
  const hits = run("find", { query: "acct-curr-bal", limit: 5 })
  expect(hits[0]).toMatchObject({ kind: "field", name: "ACCT-CURR-BAL", file: "app/cpy/CVACT01Y.cpy" })
  expect(run("find", { query: "CBACT0" }).filter((h: { kind: string }) => h.kind === "program")).toHaveLength(4)
  const system = run("diagram", {}).mermaid as string
  expect(system.startsWith("flowchart LR")).toBe(true)
  expect(system).toContain("COSGN00C -->|xctl| COMEN01C")
  expect(system).toContain("job_READACCT_STEP05 --> CBACT01C")
  const paragraphs = run("diagram", { program: "CBACT01C" }).mermaid as string
  expect(paragraphs).toContain("_main_ --> 1000_ACCTFILE_GET_NEXT")
  expect(paragraphs).toContain('ext_COBDATFT(["COBDATFT"])')
})
