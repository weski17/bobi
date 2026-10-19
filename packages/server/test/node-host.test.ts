// The Node-based Bobi server: sessions with bobi.core, authentication, and terminal WebSockets.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DEFAULTS, SDK_OFFLINE_OPTIONS, toOpenCodeConfig } from "@bobi/config"
import { createBobiCore, MemorySink } from "@bobi/core"
import { startMockModel, type MockModel } from "@bobi/mock-model"
import { OpenCode } from "@opencode/client"
import { bobiPaths } from "../src/paths.ts"
import { startNodeServer, type NodeServer } from "../src/node-host.ts"

const password = "node-host-password-123456"
let mock: MockModel
let home: string
let dir: string
let server: NodeServer
const auth = `Basic ${btoa(`opencode:${password}`)}`

beforeAll(async () => {
  mock = startMockModel()
  home = await mkdtemp(path.join(tmpdir(), "bobi-node-home-"))
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-node-proj-")))
  process.env.BOBI_MODEL_API_KEY = "node-test"
  const config = { ...structuredClone(DEFAULTS), model: { ...DEFAULTS.model, baseURL: mock.baseURL, default: "mock-model" }, telemetry: { user: "n" } }
  const paths = bobiPaths({ BOBI_HOME: home })
  server = await startNodeServer({
    engine: {
      app: { name: "bobi", version: "local", channel: "local" },
      config: { directory: paths.config, project: false, claude: false, content: JSON.stringify(toOpenCodeConfig(config)) },
      database: { path: paths.database },
      events: { persist: true },
      ...SDK_OFFLINE_OPTIONS,
    },
    paths,
    plugin: createBobiCore({ config, audit: new MemorySink(), globalDir: home, trusted: () => true, browser: false }),
    password,
  })
})
afterAll(async () => {
  await server.stop()
  await mock.stop()
  await rm(home, { recursive: true, force: true })
  await rm(dir, { recursive: true, force: true })
})

const client = () =>
  OpenCode.make({
    baseUrl: server.url,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), authorization: auth } })) as typeof fetch,
  })

test("requires the password", async () => {
  expect((await fetch(`${server.url}/api/session`)).status).toBe(401)
  expect((await fetch(`${server.url}/api/session`, { headers: { authorization: auth } })).status).toBe(200)
})

test("runs sessions with bobi.core: writes ask for approval", async () => {
  const c = client()
  const file = path.join(dir, "x.txt")
  mock.enqueue({ toolCalls: [{ name: "write", arguments: { path: file, content: "x" } }] }, { text: "done" })
  const session = await c.session.create({ location: { directory: dir } })
  await c.session.prompt({ sessionID: session.id, text: "write" })
  let pending: { id: string; action: string } | undefined
  for (let i = 0; i < 200 && !pending; i++) {
    pending = (await c.permission.list({ sessionID: session.id }))[0]
    if (!pending) await Bun.sleep(25)
  }
  expect(pending?.action).toBe("edit")
  await c.permission.reply({ sessionID: session.id, requestID: pending!.id, decision: "reject" })
  await c.session.wait({ sessionID: session.id })
  expect(existsSync(file)).toBe(false)
}, 60_000)

test("terminals work over WebSocket with a one-time ticket", async () => {
  const c = client()
  const pty = (await c.pty.create({ location: { directory: dir }, command: "bash", args: ["--norc", "-i"], cwd: dir })).data
  const { ticket } = (await c.pty.connect.token({ ptyID: pty.id, location: { directory: dir }, "x-opencode-ticket": "1" })).data
  const url = `${server.url.replace("http", "ws")}/api/pty/${pty.id}/connect?ticket=${encodeURIComponent(ticket)}&location%5Bdirectory%5D=${encodeURIComponent(dir)}`
  const output = await new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(url)
    let text = ""
    const timer = setTimeout(() => (ws.close(), resolve(text)), 8000)
    ws.onopen = () => ws.send("echo bobi-$((40+2))\r")
    ws.onmessage = (e) => {
      text += typeof e.data === "string" ? e.data : new TextDecoder().decode(e.data as ArrayBuffer)
      if (text.includes("bobi-42")) {
        clearTimeout(timer)
        ws.close()
        resolve(text)
      }
    }
    ws.onerror = (e) => reject(new Error(`websocket error: ${String((e as ErrorEvent).message ?? e.type)}`))
  })
  expect(output).toContain("bobi-42")
}, 30_000)

test("a ticket URL without a valid ticket is refused", async () => {
  const res = await fetch(`${server.url}/api/pty/pty_unknown/connect?ticket=forged`)
  expect(res.status).not.toBe(200)
})

test("engine logs go to a file, not to the terminal", () => {
  expect(existsSync(path.join(home, "data", "log", "server.log"))).toBe(true)
  expect(readFileSync(path.join(home, "data", "log", "server.log"), "utf8").length).toBeGreaterThan(0)
})
