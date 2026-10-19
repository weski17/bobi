// Phase 6: COBOL analysis and mainframe access as built-in MCP servers, with Bobi's approvals.
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test"
import { cpSync } from "node:fs"
import path from "node:path"
import { CLI as COBOL_CLI } from "@bobi/mcp-cobol"
import { CLI as ZOWE_CLI, startMockMainframe, type MockMainframe } from "@bobi/mcp-zowe"
import { createHarness, pendingPermission, waitFor, type Harness } from "./harness.ts"

const COBOL_FIXTURE = path.resolve(import.meta.dir, "..", "..", "mcp-servers", "cobol", "test", "fixture")
const password = crypto.randomUUID()
let h: Harness | undefined
let mainframe: MockMainframe
beforeAll(() => {
  mainframe = startMockMainframe({ user: "dev1", password })
  mainframe.datasets.set("DEV1.COBOL.SRC(PAYCALC)", "       PROGRAM-ID. PAYCALC.\n")
})
afterAll(() => mainframe.stop())
afterEach(async () => {
  await h?.close()
  h = undefined
})

const done = { text: "done" }
const agentRequests = (h: Harness) => h.mock.requests.filter((r) => (r.body.tools?.length ?? 0) > 0)
const toolNames = (h: Harness) => agentRequests(h).at(-1)!.body.tools!.map((t) => t.function.name)
const toolText = (h: Harness) => JSON.stringify(agentRequests(h).at(-1)!.body.messages.filter((m) => m.role === "tool"))
const connected = (h: Harness, server: string) =>
  waitFor(async () => {
    const sessionID = await h.promptIn("advanced", "probe")
    await h.opencode.sessions.wait({ sessionID })
    return toolNames(h).some((t) => t.startsWith(`${server}_`)) ? true : (await Bun.sleep(200), undefined)
  }, 20_000)

const mainframeEnv = () => ({
  ZOWE_OPT_HOST: "127.0.0.1",
  ZOWE_OPT_PORT: String(mainframe.port),
  ZOWE_OPT_PROTOCOL: "http",
  ZOWE_OPT_USER: "dev1",
  ZOWE_OPT_PASSWORD: password,
})

test("the COBOL server answers impact questions in advanced mode", async () => {
  h = await createHarness({ autoApprove: [{ action: "mcp", resource: "cobol_*", modes: [] }] }, [], {
    builtinMcp: (project) => ({ cobol: { type: "local", command: [process.execPath, COBOL_CLI, project] } }),
  })
  cpSync(COBOL_FIXTURE, h.dir, { recursive: true })
  await connected(h, "cobol")
  expect(toolNames(h)).toEqual(expect.arrayContaining(["cobol_impact", "cobol_data_flow", "cobol_program_outline"]))
  const sessionID = await h.promptIn("advanced", "what breaks if EMPREC changes?", { toolCalls: [{ name: "cobol_impact", arguments: { copybook: "EMPREC" } }] }, done)
  await h.opencode.sessions.wait({ sessionID })
  expect(toolText(h)).toContain("PAYRUN.STEP01")
  expect(toolText(h)).toContain('<untrusted-data source=\\"cobol_impact\\">')
}, 60_000)

test("mainframe: reads can be auto-approved, writes and job submission always ask", async () => {
  h = await createHarness({ autoApprove: [{ action: "mcp", resource: "zowe_*", modes: [] }] }, [password], {
    builtinMcp: (project) => ({ zowe: { type: "local", command: [process.execPath, ZOWE_CLI, project], env: mainframeEnv() } }),
  })
  await connected(h, "zowe")
  const read = await h.promptIn("advanced", "show PAYCALC", { toolCalls: [{ name: "zowe_read_dataset", arguments: { dataset: "DEV1.COBOL.SRC", member: "PAYCALC" } }] }, done)
  await h.opencode.sessions.wait({ sessionID: read })
  expect(toolText(h)).toContain("PROGRAM-ID. PAYCALC.")
  expect(await h.opencode.permission.list({ sessionID: read })).toEqual([])

  const write = await h.promptIn("advanced", "fix it", { toolCalls: [{ name: "zowe_write_dataset", arguments: { dataset: "DEV1.COBOL.SRC", member: "PAYCALC", content: "changed" } }] })
  const writeRequest = await pendingPermission(h, write)
  expect(writeRequest.action).toBe("zowe_write_dataset")
  // A rejection ends the turn without another model call.
  await h.opencode.permission.reply({ sessionID: write, requestID: writeRequest.id, decision: "reject" })
  await h.opencode.sessions.wait({ sessionID: write })
  expect(mainframe.datasets.get("DEV1.COBOL.SRC(PAYCALC)")).toBe("       PROGRAM-ID. PAYCALC.\n")

  const submit = await h.promptIn("advanced", "run", { toolCalls: [{ name: "zowe_submit_job", arguments: { jcl: "//T JOB 1\n//S EXEC PGM=IEFBR14\n" } }] }, done)
  const submitRequest = await pendingPermission(h, submit)
  expect(submitRequest.action).toBe("zowe_submit_job")
  await h.opencode.permission.reply({ sessionID: submit, requestID: submitRequest.id, decision: "once" })
  await h.opencode.sessions.wait({ sessionID: submit })
  expect(mainframe.jobs.map((j) => j.jobname)).toContain("T")
}, 90_000)
