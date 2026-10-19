// Phase 3: MCP client in Bobi – built-in code graph server, approvals, per-mode access, remote servers.
import { afterEach, expect, test } from "bun:test"
import { cpSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { Server, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server"
import { createHarness, pendingPermission, waitFor, type Harness } from "./harness.ts"

const FIXTURE = path.resolve(import.meta.dir, "..", "..", "mcp-servers", "code-graph", "test", "fixture")
let h: Harness | undefined
let remote: ReturnType<typeof Bun.serve> | undefined
afterEach(async () => {
  await h?.close()
  remote?.stop(true)
  h = undefined
  remote = undefined
})

const done = { text: "done" }
const agentRequests = (h: Harness) => h.mock.requests.filter((r) => (r.body.tools?.length ?? 0) > 0)
const toolNames = (h: Harness, i = -1) => agentRequests(h).at(i)!.body.tools!.map((t) => t.function.name)
const toolText = (h: Harness) => JSON.stringify(agentRequests(h).at(-1)!.body.messages.filter((m) => m.role === "tool"))

/** Waits until the server's tools are offered to the model (connection plus tool catalog are asynchronous). */
const connected = (h: Harness, server: string) =>
  waitFor(async () => {
    const sessionID = await h.promptIn("advanced", "probe")
    await h.opencode.sessions.wait({ sessionID })
    return toolNames(h).some((t) => t.startsWith(`${server}_`)) ? true : (await Bun.sleep(200), undefined)
  }, 20_000)

async function withProject(options: Parameters<typeof createHarness>[2], patch: Parameters<typeof createHarness>[0] = {}) {
  h = await createHarness(patch, [], { codeGraph: true, ...options })
  cpSync(path.join(FIXTURE, "src"), path.join(h.dir, "src"), { recursive: true })
  return h
}

test("advanced mode sees the code graph tools, code mode does not", async () => {
  const h = await withProject({})
  await connected(h, "code-graph")
  expect(toolNames(h)).toEqual(expect.arrayContaining(["code-graph_find_symbol", "code-graph_callers", "code-graph_call_path"]))
  const code = await h.promptIn("code", "code", done)
  await h.opencode.sessions.wait({ sessionID: code })
  expect(toolNames(h).some((t) => t.startsWith("code-graph_"))).toBe(false)
  expect(toolNames(h)).not.toContain("opencode_read_mcp_resource")
}, 60_000)

test("an MCP call asks for approval and returns the result as untrusted data", async () => {
  const h = await withProject({})
  await connected(h, "code-graph")
  const sessionID = await h.promptIn("advanced", "who calls add?", { toolCalls: [{ name: "code-graph_callers", arguments: { symbol: "add" } }] }, done)
  const request = await pendingPermission(h, sessionID)
  expect(request.action).toBe("code-graph_callers")
  await h.opencode.permission.reply({ sessionID, requestID: request.id, decision: "once" })
  await h.opencode.sessions.wait({ sessionID })
  const tool = toolText(h)
  expect(tool).toContain('<untrusted-data source=\\"code-graph_callers\\">')
  expect(tool).toContain("src/legacy.js#sum")
}, 60_000)

test("explicit auto-approval for one MCP server skips the question", async () => {
  const h = await withProject({}, { autoApprove: [{ action: "mcp", resource: "code-graph_*", modes: [] }] })
  await connected(h, "code-graph")
  const sessionID = await h.promptIn("advanced", "path", { toolCalls: [{ name: "code-graph_call_path", arguments: { from: "main", to: "double" } }] }, done)
  await h.opencode.sessions.wait({ sessionID })
  expect(toolText(h)).toContain("src/user.ts#UserService.score")
  expect(await h.opencode.permission.list({ sessionID })).toEqual([])
}, 60_000)

test("a mode limited to other MCP servers cannot use the code graph", async () => {
  const h = await withProject({})
  await mkdir(path.join(h.dir, ".bobi"))
  await writeFile(path.join(h.dir, ".bobi", "custom_modes.yaml"), "customModes:\n  - slug: tickets\n    name: Tickets\n    roleDefinition: r\n    groups:\n      - read\n      - - mcp\n        - servers: [jira]\n")
  await connected(h, "code-graph")
  const sessionID = await h.promptIn("tickets", "graph", { toolCalls: [{ name: "code-graph_callers", arguments: { symbol: "add" } }] }, done)
  await h.opencode.sessions.wait({ sessionID })
  expect(toolNames(h).some((t) => t.startsWith("code-graph_"))).toBe(false)
  expect(toolText(h)).not.toContain("src/legacy.js#sum")
}, 60_000)

test("a remote MCP server receives its token from the environment", async () => {
  const seen: (string | null)[] = []
  remote = Bun.serve({
    port: 0,
    async fetch(request) {
      seen.push(request.headers.get("authorization"))
      const server = new Server({ name: "tickets", version: "1.0.0" }, { capabilities: { tools: {} } })
      server.setRequestHandler("tools/list", async () => ({ tools: [{ name: "lookup", description: "Find a ticket", inputSchema: { type: "object", properties: { id: { type: "string" } } } }] }))
      server.setRequestHandler("tools/call", async () => ({ content: [{ type: "text", text: "TICKET-42: fix login" }] }))
      const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      await server.connect(transport)
      return transport.handleRequest(request)
    },
  })
  h = await createHarness(
    {
      autoApprove: [{ action: "mcp", resource: "tickets_*", modes: [] }],
      mcp: { servers: { tickets: { type: "remote", url: `http://127.0.0.1:${remote.port}/mcp`, headers: { Authorization: "Bearer ${TICKETS_TOKEN}" } } } },
    },
    [],
    { env: { TICKETS_TOKEN: "secret-from-env" } },
  )
  await connected(h, "tickets")
  const sessionID = await h.promptIn("advanced", "ticket?", { toolCalls: [{ name: "tickets_lookup", arguments: { id: "42" } }] }, done)
  await h.opencode.sessions.wait({ sessionID })
  expect(seen).toContain("Bearer secret-from-env")
  expect(toolText(h)).toContain("TICKET-42: fix login")
}, 60_000)

test("a server with a missing environment variable is disabled, not started with an empty token", async () => {
  h = await createHarness({ mcp: { servers: { tickets: { type: "remote", url: "http://127.0.0.1:1/mcp", headers: { Authorization: "Bearer ${NOT_SET}" } } } } }, [], { env: {} })
  const warm = await h.promptIn("advanced", "warm up", done)
  await h.opencode.sessions.wait({ sessionID: warm })
  const list = await h.opencode.mcp.list({ location: { directory: h.dir } })
  expect((list.data as { name: string; status: { status: string } }[]).find((s) => s.name === "tickets")?.status.status).toBe("disabled")
}, 30_000)
