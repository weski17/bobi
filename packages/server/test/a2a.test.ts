// Inbound A2A against the real Bobi server: discovery, password, read-only answers, no hanging approvals.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DEFAULTS } from "@bobi/config"
import { MemorySink } from "@bobi/core"
import { startMockModel, type MockModel } from "@bobi/mock-model"
import { bobiPaths, startBobiServer, type BobiServer } from "../src/index.ts"

const password = crypto.randomUUID()
const auth = { authorization: `Basic ${btoa(`opencode:${password}`)}` }
let mock: MockModel
let home: string
let dir: string
let server: BobiServer
const audit = new MemorySink()

beforeAll(async () => {
  mock = startMockModel()
  home = await mkdtemp(path.join(tmpdir(), "bobi-a2a-home-"))
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-a2a-proj-")))
  await mkdir(path.join(dir, ".git"))
  await writeFile(path.join(dir, "app.ts"), "export const answer = 41\n")
  await writeFile(path.join(dir, "server.pem"), "-----BEGIN PRIVATE KEY-----\n")
  server = await startBobiServer({
    config: { ...structuredClone(DEFAULTS), model: { ...DEFAULTS.model, baseURL: mock.baseURL, default: "mock-model" }, telemetry: { user: "srv" }, a2a: { enabled: true, agents: {} } },
    paths: bobiPaths({ BOBI_HOME: home }),
    password,
    audit,
    browser: false,
    directory: dir,
    env: { BOBI_HOME: home, HOME: home, BOBI_MODEL_API_KEY: "a2a-test" },
  })
})
afterAll(async () => {
  await server.stop()
  await mock.stop()
  await rm(home, { recursive: true, force: true })
  await rm(dir, { recursive: true, force: true })
})

const send = async (text: string, extra: Record<string, unknown> = {}) => {
  const response = await fetch(`${server.url}/a2a`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { kind: "message", role: "user", messageId: crypto.randomUUID(), parts: [{ kind: "text", text }], ...extra } } }),
  })
  return (await response.json()) as { result: { id: string; contextId: string; status: { state: string; message?: { parts: { text: string }[] } } } }
}

test("the agent card is public, the endpoint needs the server password", async () => {
  const card = await (await fetch(`${server.url}/.well-known/agent-card.json`)).json()
  expect(card).toMatchObject({ name: "Bobi", url: `${server.url}/a2a`, securitySchemes: { basic: { type: "http", scheme: "basic" } } })
  expect((await fetch(`${server.url}/a2a`, { method: "POST", body: "{}" })).status).toBe(401)
})

test("a task is answered in the read-only a2a agent: only read tools, no auto-approvals", async () => {
  mock.enqueue({ toolCalls: [{ name: "read", arguments: { path: path.join(dir, "app.ts") } }] }, { text: "The answer is 41 (app.ts:1)." })
  const { result } = await send("What is the answer?")
  expect(result.status.state).toBe("completed")
  expect(result.status.message!.parts[0]!.text).toBe("The answer is 41 (app.ts:1).")
  const agentRequest = mock.requests.filter((r) => (r.body.tools?.length ?? 0) > 0).at(-1)!
  expect(agentRequest.body.tools!.map((t) => t.function.name).sort()).toEqual(["glob", "grep", "read", "skill"])
  expect(JSON.stringify(agentRequest.body.messages)).toContain("over the A2A protocol")
})

test("writes, commands and reads that would need approval are denied at once, never left waiting", async () => {
  mock.enqueue(
    { toolCalls: [{ name: "write", arguments: { path: path.join(dir, "app.ts"), content: "hacked" } }] },
    { toolCalls: [{ name: "shell", arguments: { command: "touch pwned" } }] },
    { toolCalls: [{ name: "read", arguments: { path: path.join(dir, "server.pem") } }] },
    { text: "I can only read." },
  )
  const { result } = await send("Change app.ts")
  expect(result.status.state).toBe("completed")
  expect(await readFile(path.join(dir, "app.ts"), "utf8")).toBe("export const answer = 41\n")
  expect(await Bun.file(path.join(dir, "pwned")).exists()).toBe(false)
  const tools = JSON.stringify(mock.requests.at(-1)!.body.messages.filter((m) => m.role === "tool"))
  expect(tools).not.toContain("BEGIN PRIVATE KEY")
  const decisions = audit.records.filter((r) => r.name === "bobi.permission" && r.attributes["bobi.mode"] === "a2a").map((r) => `${r.attributes["bobi.action"]}:${r.attributes["bobi.result"]}`)
  expect(decisions).toContain("read:deny")
  expect(audit.records.some((r) => r.name === "bobi.permission" && r.attributes["bobi.mode"] === "a2a" && r.attributes["bobi.result"] === "ask")).toBe(false)
}, 60_000)

test("a follow-up in the same context continues the session", async () => {
  mock.enqueue({ text: "First." })
  const first = await send("one")
  mock.enqueue({ text: "Second." })
  const second = await send("two", { contextId: first.result.contextId })
  expect(second.result.contextId).toBe(first.result.contextId)
  const lastAgent = mock.requests.filter((r) => (r.body.tools?.length ?? 0) > 0).at(-1)!
  expect(JSON.stringify(lastAgent.body.messages)).toContain("First.")
})

test("without a2a.enabled there is no agent card", async () => {
  const other = await startBobiServer({ config: { ...structuredClone(DEFAULTS), model: { ...DEFAULTS.model, baseURL: mock.baseURL } }, paths: bobiPaths({ BOBI_HOME: home }), password, browser: false, env: { BOBI_HOME: home, HOME: home } })
  try {
    expect((await fetch(`${other.url}/.well-known/agent-card.json`)).status).toBe(401)
    expect((await fetch(`${other.url}/a2a`, { method: "POST", headers: auth, body: "{}" })).status).toBe(404)
  } finally {
    await other.stop()
  }
}, 30_000)
