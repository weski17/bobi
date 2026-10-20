import { afterAll, beforeAll, expect, test } from "bun:test"
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { CLI, createServer, TOOLS } from "../src/index.ts"

const FIXTURE = path.join(import.meta.dir, "fixture")
let client: Client

beforeAll(async () => {
  client = new Client({ name: "test", version: "1.0.0" })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, FIXTURE] }))
}, 30_000)
afterAll(async () => {
  await client.close()
})

const call = async (c: Client, name: string, args: Record<string, unknown>) => {
  const result = await c.callTool({ name, arguments: args })
  const text = (result.content as { type: string; text: string }[])[0]!.text
  return { error: result.isError === true, text, data: result.isError ? undefined : JSON.parse(text) }
}

test("lists its tools over MCP stdio", async () => {
  const { tools } = await client.listTools()
  expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name))
})

test("answers COBOL questions", async () => {
  expect((await call(client, "list_programs", {})).data.programs.map((p: { program: string }) => p.program).sort()).toEqual(["PAYCALC", "TAXCALC"])
  expect((await call(client, "program_outline", { program: "cbl/PAYCALC.cbl" })).data.program).toBe("PAYCALC")
  expect((await call(client, "performs", { program: "PAYCALC", paragraph: "0000-MAIN" })).data.callees).toHaveLength(3)
  expect((await call(client, "program_calls", { program: "PAYCALC" })).data.callees.map((c: { program: string; inProject: boolean }) => [c.program, c.inProject])).toEqual([
    ["TAXCALC", true],
    ["PAYAUDIT", false],
  ])
  expect((await call(client, "program_calls", { program: "PAYCALC", direction: "callers" })).data.jobs).toEqual(["PAYRUN.STEP01 (jcl/PAYRUN.jcl)"])
  expect((await call(client, "field", { program: "PAYCALC", field: "WS-GROSS" })).data.passedTo).toHaveLength(2)
  expect((await call(client, "data_flow", { program: "PAYCALC", field: "WS-SALARY", depth: 5 })).data.downstream.map((s: { field: string }) => s.field)).toEqual(
    expect.arrayContaining(["WS-GROSS", "WS-TAX", "WS-NET", "WS-PAYOUT"]),
  )
  expect((await call(client, "impact", { copybook: "EMPREC" })).data.jobs).toEqual(["PAYRUN.STEP01 (jcl/PAYRUN.jcl)"])
  expect((await call(client, "impact", { dataset: "prod.payroll.*" })).data.programs).toMatchObject([{ program: "PAYCALC", file: "EMP-FILE", dd: "EMPIN", records: ["EMP-FILE-REC"] }])
  expect((await call(client, "impact", { program: "TAXCALC" })).data.callers).toMatchObject([{ program: "PAYCALC", kind: "call" }])
  expect((await call(client, "impact", { field: "WS-SALARY", program: "PAYCALC" })).data.programs[0].paragraphs).toEqual(["1000-READ", "2000-CALC"])
  expect((await call(client, "find", { query: "CALC" })).data.length).toBeGreaterThan(2)
  expect((await call(client, "diagram", { program: "PAYCALC" })).data.mermaid).toContain("1000_READ")
})

test("explains bad input as tool errors", async () => {
  const errors: [string, Record<string, unknown>, string][] = [
    ["program_outline", {}, '"program" is required'],
    ["program_outline", { program: "PAYCALX" }, "Similar: PAYCALC"],
    ["program_outline", { program: "ZZZZ" }, "Unknown program"],
    ["performs", { program: "PAYCALC", paragraph: "NOPE" }, "no paragraph"],
    ["performs", { program: "PAYCALC", direction: "sideways" }, "must be one of callees, callers"],
    ["performs", { program: "PAYCALC", depth: 0 }, "between 1 and 10"],
    ["field", { program: "PAYCALC", field: "NOPE" }, "no data item"],
    ["impact", {}, "Give one of"],
    ["impact", { field: "WS-NET" }, '"program" is required'],
    ["impact", { copybook: "DFHAID" }, "system copybook"],
    ["impact", { copybook: "NOPE" }, "Unknown copybook"],
    ["list_programs", { query: "" }, "non-empty string"],
    ["nope", {}, "Unknown tool"],
  ]
  for (const [name, args, message] of errors) {
    const result = await call(client, name, args)
    expect(result.error).toBe(true)
    expect(result.text).toContain(message)
  }
})

test("in-process: the index is rebuilt when files change", async () => {
  const copy = mkdtempSync(path.join(tmpdir(), "bobi-cobol-"))
  cpSync(FIXTURE, copy, { recursive: true })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await createServer(copy).connect(serverSide)
  const local = new Client({ name: "t", version: "1" })
  await local.connect(clientSide)
  try {
    expect((await call(local, "list_programs", {})).data.programs).toHaveLength(2)
    writeFileSync(path.join(copy, "cbl", "NEWPGM.cbl"), "       IDENTIFICATION DIVISION.\n       PROGRAM-ID. NEWPGM.\n       PROCEDURE DIVISION.\n           GOBACK.\n")
    writeFileSync(path.join(copy, "cbl", "BIG.cbl"), `      * ${"x".repeat(2_100_000)}\n`)
    const after = (await call(local, "list_programs", {})).data
    expect(after.programs.map((p: { program: string }) => p.program)).toContain("NEWPGM")
    expect(after.problems).toEqual([{ file: "cbl/BIG.cbl", message: "skipped: file larger than 2 MB" }])
    writeFileSync(path.join(copy, "cbl", "DUP.cbl"), "       IDENTIFICATION DIVISION.\n       PROGRAM-ID. NEWPGM.\n")
    expect((await call(local, "list_programs", {})).data.problems).toContainEqual({ file: "cbl/NEWPGM.cbl", message: "duplicate PROGRAM-ID NEWPGM; first one kept" })
  } finally {
    await local.close()
    rmSync(copy, { recursive: true, force: true })
  }
})
