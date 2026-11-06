// The gate in front of a real Bobi server (engine + bobi.core + mock model): login, cross-site protection, the list of
// reachable API calls, and the whole chat flow (streaming answer, edit approval, undo) through it.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DEFAULTS } from "@bobi/config"
import { startMockModel, type MockModel } from "@bobi/mock-model"
import { bobiPaths, startBobiServer, type BobiServer } from "@bobi/server"
import { BobiClient } from "../../ide-extension/src/client.ts"
import { ChatController, type ToUi } from "../../ide-extension/src/controller.ts"
import { ALLOWED, startGate } from "../src/gate.ts"

const serverPassword = "gate-test-server-password"
const visitor = "gate-test-visitor-password"
const login = `Basic ${btoa(`demo:${visitor}`)}`
let mock: MockModel
let server: BobiServer
let gate: ReturnType<typeof startGate>
let home: string
let dir: string
let assets: string

beforeAll(async () => {
  mock = startMockModel()
  home = await mkdtemp(path.join(tmpdir(), "bobi-gate-home-"))
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-gate-proj-")))
  assets = await mkdtemp(path.join(tmpdir(), "bobi-gate-assets-"))
  for (const f of ["index.html", "main.js", "chat.js", "chat.css", "bobi.svg"]) await writeFile(path.join(assets, f), `asset ${f}`)
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir })
  await writeFile(path.join(dir, "app.ts"), "export const answer = 41\n")
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "add", "."], { cwd: dir })
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"], { cwd: dir })
  process.env.BOBI_MODEL_API_KEY = "gate-test"
  server = await startBobiServer({
    config: { ...structuredClone(DEFAULTS), model: { ...DEFAULTS.model, baseURL: mock.baseURL, default: "mock-model" }, telemetry: { user: "gate" } },
    paths: bobiPaths({ BOBI_HOME: home }),
    password: serverPassword,
    browser: false,
  })
  gate = startGate({ port: 0, hostname: "127.0.0.1", password: visitor, upstream: server.url, serverPassword, directory: dir, publicDir: assets, distDir: assets, mediaDir: assets })
})
afterAll(async () => {
  void gate.stop(true)
  await server.stop()
  await mock.stop()
  for (const d of [home, dir, assets]) await rm(d, { recursive: true, force: true })
})

const get = (p: string, headers: Record<string, string> = { authorization: login }) => fetch(new URL(p, gate.url), { headers })

test("without the right login nothing is served", async () => {
  expect((await get("/", {})).status).toBe(401)
  expect((await get("/", {})).headers.get("www-authenticate")).toContain("Basic")
  for (const bad of [`Basic ${btoa("demo:wrong")}`, `Basic ${btoa(`other:${visitor}`)}`, `Basic ${btoa("nocolon")}`, "Basic !!!", "Bearer x", `Basic ${btoa(`opencode:${serverPassword}`)}`])
    expect((await get("/api/agent", { authorization: bad })).status).toBe(401)
})

test("serves the page files with a strict content security policy", async () => {
  const page = await get("/")
  expect(page.status).toBe(200)
  expect(await page.text()).toBe("asset index.html")
  expect(page.headers.get("content-security-policy")).toContain("default-src 'none'")
  expect(page.headers.get("x-content-type-options")).toBe("nosniff")
  expect(await (await get("/main.js")).text()).toBe("asset main.js")
  expect(((await (await get("/config.json")).json()) as { directory: string }).directory).toBe(dir)
  expect((await get("/chat.js.map")).status).toBe(404)
  expect((await get("/../etc/passwd")).status).toBe(404)
})

test("a missing build is reported, not crashed", async () => {
  const other = startGate({ port: 0, hostname: "127.0.0.1", password: visitor, upstream: server.url, serverPassword, directory: dir, publicDir: "/nonexistent", distDir: "/nonexistent", mediaDir: "/nonexistent" })
  const r = await fetch(new URL("/main.js", other.url), { headers: { authorization: login } })
  expect(r.status).toBe(404)
  expect(await r.text()).toContain("not built")
  void other.stop(true)
})

test("cross-site requests are refused, same-site ones pass", async () => {
  const evil = await fetch(new URL("/api/session", gate.url), { method: "POST", headers: { authorization: login, origin: "https://evil.example", "content-type": "application/json" }, body: "{}" })
  expect(evil.status).toBe(403)
  const own = await get("/config.json", { authorization: login, origin: gate.url.origin })
  expect(own.status).toBe(200)
})

test("only the calls the chat needs reach the server", async () => {
  expect(ALLOWED.length).toBeGreaterThan(0)
  for (const [method, p] of [
    ["GET", "/api/session"],
    ["DELETE", "/api/session/abc"],
    ["GET", "/api/config"],
    ["POST", "/api/session/abc/shell"],
    ["POST", "/api/session/a/b/prompt"],
    ["GET", "/api/session/abc/prompt"],
    ["POST", "/bobi/complete"],
    ["GET", "/api/agent/../config"],
  ] as const) {
    const r = await fetch(new URL(p, gate.url), { method, headers: { authorization: login }, ...(method === "POST" ? { body: "{}" } : {}) })
    expect([method, p, r.status]).toEqual([method, p, 404])
  }
})

test("an unreachable server is a 502, not a crash", async () => {
  const lonely = startGate({ port: 0, hostname: "127.0.0.1", password: visitor, upstream: "http://127.0.0.1:1", serverPassword, directory: dir, publicDir: assets, distDir: assets, mediaDir: assets })
  const r = await fetch(new URL("/api/agent", lonely.url), { headers: { authorization: login } })
  expect(r.status).toBe(502)
  void lonely.stop(true)
})

test("the whole chat works through the gate: modes, streamed answer, edit approval and undo", async () => {
  const posts: ToUi[] = []
  const withLogin = ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), authorization: login } })) as typeof fetch
  const controller = new ChatController(new BobiClient(gate.url.origin, undefined, withLogin), dir, {
    post: (m) => void posts.push(m),
    showDiff: async () => {},
    error: (message) => void posts.push({ type: "error", message }),
  })
  const until = async (check: () => boolean) => {
    const end = Date.now() + 15_000
    while (!check()) {
      if (Date.now() > end) throw new Error(`timed out; posts: ${JSON.stringify(posts).slice(0, 600)}`)
      await Bun.sleep(25)
    }
  }
  try {
    await controller.start()
    expect((posts.find((p) => p.type === "ready") as Extract<ToUi, { type: "ready" }>).modes.map((m) => m.id).slice(0, 2)).toEqual(["code", "plan"])

    mock.enqueue({ text: "Hello through the gate." })
    await controller.send("hi")
    await until(() => posts.some((p) => p.type === "busy" && !p.busy))
    expect(posts.filter((p) => p.type === "text").map((p) => (p as { delta: string }).delta).join("")).toBe("Hello through the gate.")

    const file = path.join(dir, "app.ts")
    mock.enqueue({ toolCalls: [{ name: "edit", arguments: { path: file, oldString: "41", newString: "42" } }] }, { text: "Fixed." })
    posts.length = 0
    await controller.send("fix the answer")
    await until(() => posts.some((p) => p.type === "approval"))
    const approval = posts.find((p) => p.type === "approval") as Extract<ToUi, { type: "approval" }>
    expect(await readFile(file, "utf8")).toBe("export const answer = 41\n")
    await controller.reply(approval.id, "once")
    await until(() => posts.some((p) => p.type === "busy" && !p.busy))
    expect(await readFile(file, "utf8")).toBe("export const answer = 42\n")
    expect(await controller.undo()).toBe(true)
    expect(await readFile(file, "utf8")).toBe("export const answer = 41\n")
  } finally {
    controller.stop()
  }
}, 60_000)
