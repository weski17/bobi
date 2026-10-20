// Phase 6: COBOL analysis and mainframe access as built-in MCP servers, with Bobi's approvals.
import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test"
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
  // The user's answers are part of the audit trail.
  const answers = h.audit.records.filter((r) => r.name === "bobi.approval").map((r) => `${r.attributes["bobi.action"]}:${r.attributes["bobi.result"]}:${r.attributes["bobi.mode"]}`)
  expect(answers).toEqual(["zowe_write_dataset:reject:advanced", "zowe_submit_job:once:advanced"])
}, 90_000)

test("outbound A2A: only in modes with the mcp group, always asks, answer is untrusted, token from the environment", async () => {
  const { agentCard, CARD_PATH, InboundA2a, RPC_PATH } = await import("@bobi/a2a")
  const token = crypto.randomUUID()
  const seen: (string | null)[] = []
  const remote = new InboundA2a({
    agent: "remote",
    pollMs: 1,
    engine: { createSession: async () => "r1", prompt: async () => {}, answer: async () => "TICKET-7 is assigned to the payments team", interrupt: async () => {} },
  })
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      seen.push(request.headers.get("authorization"))
      if (url.pathname === CARD_PATH) return Response.json(agentCard({ baseUrl: url.origin, version: "1" }))
      if (url.pathname === RPC_PATH) return remote.handle(request)
      return new Response("not found", { status: 404 })
    },
  })
  try {
    // Even a blanket MCP auto-approval does not cover asking another agent.
    h = await createHarness(
      {
        autoApprove: [{ action: "mcp", resource: "*", modes: [] }],
        a2a: { enabled: false, agents: { tickets: { url: `http://127.0.0.1:${server.port}`, headers: { Authorization: "Bearer ${TICKETS_A2A_TOKEN}" }, description: "ticket system" } } },
      },
      [],
      { env: { TICKETS_A2A_TOKEN: token } },
    )
    const code = await h.promptIn("code", "who owns TICKET-7?", done)
    await h.opencode.sessions.wait({ sessionID: code })
    expect(toolNames(h)).not.toContain("a2a")
    const sessionID = await h.promptIn("advanced", "who owns TICKET-7?", { toolCalls: [{ name: "a2a", arguments: { agent: "tickets", message: "Who owns TICKET-7?" } }] }, done)
    const request = await pendingPermission(h, sessionID)
    expect(toolNames(h)).toContain("a2a")
    expect(request).toMatchObject({ action: "a2a", resources: ["tickets"] })
    await h.opencode.permission.reply({ sessionID, requestID: request.id, decision: "once" })
    await h.opencode.sessions.wait({ sessionID })
    expect(toolText(h)).toContain('<untrusted-data source=\\"a2a\\">')
    expect(toolText(h)).toContain("TICKET-7 is assigned to the payments team")
    expect(seen).toContain(`Bearer ${token}`)
  } finally {
    server.stop(true)
  }
}, 60_000)

test("outbound A2A: an agent whose token variable is missing is not offered", async () => {
  const warn = spyOn(console, "error").mockImplementation(() => {})
  try {
    h = await createHarness({ a2a: { enabled: false, agents: { tickets: { url: "http://127.0.0.1:1", headers: { Authorization: "Bearer ${NOT_SET_A2A}" } } } } }, [], { env: {} })
    const sessionID = await h.promptIn("advanced", "x", done)
    await h.opencode.sessions.wait({ sessionID })
    expect(toolNames(h)).not.toContain("a2a")
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('A2A agent "tickets" disabled: missing environment variable(s) NOT_SET_A2A'))
  } finally {
    warn.mockRestore()
  }
}, 30_000)
