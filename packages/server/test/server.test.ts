import { afterAll, beforeAll, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DEFAULTS } from "@bobi/config"
import { MemorySink } from "@bobi/core"
import { startMockModel, type MockModel } from "@bobi/mock-model"
import { OpenCode } from "@opencode/client"
import { bobiPaths, startBobiServer, type BobiServer } from "../src/index.ts"

const password = "test-password-0123456789"
let mock: MockModel
let home: string
let dir: string
let server: BobiServer
const audit = new MemorySink()

const client = (pw = password) =>
  OpenCode.make({
    baseUrl: server.url,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), authorization: `Basic ${btoa(`opencode:${pw}`)}` } })) as typeof fetch,
  })

beforeAll(async () => {
  mock = startMockModel()
  home = await mkdtemp(path.join(tmpdir(), "bobi-home-"))
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-proj-")))
  process.env.BOBI_MODEL_API_KEY = "server-test"
  server = await startBobiServer({
    config: { ...structuredClone(DEFAULTS), model: { ...DEFAULTS.model, baseURL: mock.baseURL, default: "mock-model" }, telemetry: { user: "srv" } },
    paths: bobiPaths({ BOBI_HOME: home }),
    password,
    audit,
    browser: false,
  })
})
afterAll(async () => {
  await server.stop()
  await mock.stop()
  await rm(home, { recursive: true, force: true })
  await rm(dir, { recursive: true, force: true })
})

test("rejects requests without the right password", async () => {
  expect((await fetch(`${server.url}/api/session`)).status).toBe(401)
  expect((await fetch(`${server.url}/api/session`, { headers: { authorization: `Basic ${btoa("opencode:wrong-password-000000")}` } })).status).toBe(401)
  expect((await fetch(`${server.url}/api/session`, { headers: { authorization: "Bearer x" } })).status).toBe(401)
})

test("refuses short passwords", async () => {
  await expect(startBobiServer({ config: DEFAULTS, paths: bobiPaths({ BOBI_HOME: home }), password: "short", browser: false })).rejects.toThrow(/16 characters/)
})

test("serves sessions with bobi.core built in: writes ask for approval", async () => {
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
  expect(audit.records.some((r) => r.name === "bobi.permission" && r.attributes["bobi.user"] === "srv")).toBe(true)
}, 60_000)

test("keeps its data under BOBI_HOME", () => {
  expect(existsSync(path.join(home, "data", "bobi.db"))).toBe(true)
})

test("bobiPaths defaults to ~/.bobi", () => {
  expect(bobiPaths({}).home).toEndWith("/.bobi")
  expect(bobiPaths({ BOBI_HOME: "/x" }).database).toBe("/x/data/bobi.db")
})

test("one server applies each project's own trusted config", async () => {
  mock.clear()
  const projects = await Promise.all(["a", "b"].map(async (name) => {
    const p = await realpath(await mkdtemp(path.join(tmpdir(), `bobi-multi-${name}-`)))
    Bun.spawnSync(["git", "init", "-q"], { cwd: p })
    return p
  }))
  const [approved, asking] = projects as [string, string]
  const { mkdir, writeFile } = await import("node:fs/promises")
  await mkdir(path.join(approved, ".bobi"))
  await writeFile(path.join(approved, ".bobi", "config.jsonc"), `{ "autoApprove": [{ "action": "edit", "resource": "*" }] }`)
  const { TrustStore } = await import("@bobi/config")
  new TrustStore(home).decide(approved, true)
  try {
    const c = client()
    const run = async (dir: string) => {
      mock.clear()
      const file = path.join(dir, "out.txt")
      mock.enqueue({ toolCalls: [{ name: "write", arguments: { path: file, content: "x" } }] }, { text: "done" })
      const session = await c.session.create({ location: { directory: dir } })
      await c.session.prompt({ sessionID: session.id, text: "write" })
      for (let i = 0; i < 200; i++) {
        const pending = (await c.permission.list({ sessionID: session.id }))[0]
        if (pending) {
          await c.permission.reply({ sessionID: session.id, requestID: pending.id, decision: "reject" })
          break
        }
        if (existsSync(file)) break
        await Bun.sleep(25)
      }
      await c.session.wait({ sessionID: session.id })
      return existsSync(file)
    }
    expect(await run(approved)).toBe(true)
    expect(await run(asking)).toBe(false)
  } finally {
    for (const p of projects) await rm(p, { recursive: true, force: true })
  }
}, 60_000)
