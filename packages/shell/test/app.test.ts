// runApp with an injected client: exercises the real server (engine + bobi.core) without a TTY.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startMockModel, type MockModel } from "@bobi/mock-model"
import { clientSpec, ENGINE_CLI, preloadPath, runApp, UsageError, type Io } from "../src/index.ts"

let mock: MockModel
let home: string
let dir: string

beforeAll(async () => {
  mock = startMockModel()
  home = await mkdtemp(path.join(tmpdir(), "bobi-app-home-"))
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-app-proj-")))
})
afterAll(async () => {
  await mock.stop()
  await rm(home, { recursive: true, force: true })
  await rm(dir, { recursive: true, force: true })
})

function io(overrides: Partial<Io> = {}) {
  const out: string[] = []
  const err: string[] = []
  const spawned: { argv: string[]; env: Record<string, string>; cwd: string }[] = []
  const value: Io = {
    cwd: dir,
    env: { BOBI_HOME: home, BOBI_MODEL_BASE_URL: mock.baseURL, BOBI_MODEL: "mock-model", BOBI_MODEL_API_KEY: "app-test", PATH: process.env.PATH },
    out: (l) => void out.push(l),
    err: (l) => void err.push(l),
    spawn: async (argv, env, cwd) => {
      spawned.push({ argv, env, cwd })
      // Act as the client: the server must be reachable with the password it was given.
      const url = argv[argv.indexOf("--server") + 1]!
      const ok = await fetch(`${url}/api/session`, { headers: { authorization: `Basic ${btoa(`opencode:${env.OPENCODE_PASSWORD}`)}` } })
      return ok.status === 200 ? 0 : 1
    },
    untilStopped: async () => {},
    ...overrides,
  }
  return { io: value, out, err, spawned }
}

describe("runApp", () => {
  test("help and version print and exit 0", async () => {
    const t = io()
    expect(await runApp(["--help"], t.io)).toBe(0)
    expect(await runApp(["--version"], t.io)).toBe(0)
    expect(t.out[0]).toContain("Usage:")
    expect(t.out[1]).toMatch(/^bobi \d+\.\d+\.\d+$/)
  })

  test("run starts the Bobi server and a run client connected to it", async () => {
    const t = io()
    expect(await runApp(["run", "hello"], t.io)).toBe(0)
    const [client] = t.spawned
    expect(client!.argv.slice(1, 6)).toEqual(["--preload", preloadPath(), ENGINE_CLI, "run", "hello"])
    expect(client!.cwd).toBe(dir)
    expect(client!.env).toMatchObject({ PWD: dir, OPENCODE_CLIENT: "bobi", OPENCODE_DISABLE_AUTOUPDATE: "1", XDG_DATA_HOME: path.join(home, "tui", "data") })
  }, 60_000)

  test("a project without git gets a hidden checkpoint repository once", async () => {
    const fresh = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-app-fresh-")))
    try {
      const t = io({ cwd: fresh })
      await runApp(["run", "x"], t.io)
      await runApp(["run", "x"], t.io)
      expect(t.err.filter((l) => l.includes("hidden checkpoint repository"))).toHaveLength(1)
      expect(existsSync(path.join(fresh, ".git"))).toBe(true)
    } finally {
      await rm(fresh, { recursive: true, force: true })
    }
  }, 60_000)

  test("tui opens a given project directory", async () => {
    const t = io({ cwd: path.dirname(dir) })
    expect(await runApp([path.basename(dir)], t.io)).toBe(0)
    expect(t.spawned[0]!.cwd).toBe(dir)
    expect(t.spawned[0]!.argv).not.toContain("run")
  }, 60_000)

  test("refuses a directory that does not exist", async () => {
    await expect(runApp(["no-such-dir"], io().io)).rejects.toThrow(UsageError)
  })

  test("serve prints its URL, generates a password on loopback and stops cleanly", async () => {
    const t = io()
    expect(await runApp(["serve"], t.io)).toBe(0)
    expect(JSON.parse(t.out[0]!).url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(t.err[0]).toContain("generated server password")
  }, 60_000)

  test("serve uses BOBI_SERVER_PASSWORD and never prints it", async () => {
    const t = io()
    const secret = "a-very-long-server-password"
    const env = { ...t.io.env, BOBI_SERVER_PASSWORD: secret }
    expect(await runApp(["serve", "--hostname", "127.0.0.1"], { ...t.io, env })).toBe(0)
    expect([...t.out, ...t.err].join("\n")).not.toContain(secret)
  }, 60_000)

  test("serve on a non-loopback address requires a password", async () => {
    const t = io()
    expect(await runApp(["serve", "--hostname", "0.0.0.0"], t.io)).toBe(2)
    expect(t.err[0]).toContain("BOBI_SERVER_PASSWORD is required")
  })
})

describe("project trust", () => {
  async function projectWithRules() {
    const p = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-app-trust-")))
    Bun.spawnSync(["git", "init", "-q"], { cwd: p })
    await Bun.write(path.join(p, "AGENTS.md"), "rules")
    return p
  }

  test("asks once, remembers the answer and respects no", async () => {
    const p = await projectWithRules()
    try {
      const questions: string[] = []
      const t = io({ cwd: p, ask: async (q) => (questions.push(q), false) })
      await runApp(["run", "x"], t.io)
      await runApp(["run", "x"], t.io)
      expect(questions).toHaveLength(1)
      expect(questions[0]).toContain("AGENTS.md")
      expect(t.err.filter((l) => l.includes("project not trusted"))).toHaveLength(2)
    } finally {
      await rm(p, { recursive: true, force: true })
    }
  }, 60_000)

  test("yes trusts the project", async () => {
    const p = await projectWithRules()
    try {
      const t = io({ cwd: p, ask: async () => true })
      await runApp(["run", "x"], t.io)
      expect(t.err.some((l) => l.includes("not trusted"))).toBe(false)
    } finally {
      await rm(p, { recursive: true, force: true })
    }
  }, 60_000)

  test("bobi trust shows and sets the decision as JSON (used by the IDE)", async () => {
    const p = await projectWithRules()
    try {
      const t = io({ cwd: p })
      await runApp(["trust", "--status"], t.io)
      expect(JSON.parse(t.out[0]!)).toEqual({ project: p, status: "unknown", files: ["AGENTS.md"] })
      await runApp(["trust", "--yes", p], t.io)
      expect(JSON.parse(t.out[1]!).status).toBe("trusted")
      await runApp(["trust", "--no"], t.io)
      expect(JSON.parse(t.out[2]!).status).toBe("untrusted")
    } finally {
      await rm(p, { recursive: true, force: true })
    }
  })

  test("without a terminal the project stays untrusted unless --trust is given", async () => {
    const p = await projectWithRules()
    try {
      const t = io({ cwd: p })
      await runApp(["run", "x"], t.io)
      expect(t.err.some((l) => l.includes("use --trust"))).toBe(true)
      const u = io({ cwd: p })
      await runApp(["run", "--trust", "x"], u.io)
      expect(u.err.some((l) => l.includes("not trusted"))).toBe(false)
      expect(u.spawned[0]!.argv).not.toContain("--trust")
    } finally {
      await rm(p, { recursive: true, force: true })
    }
  }, 60_000)
})

test("bobi modes lists built-in and trusted project modes", async () => {
  const t = io()
  await runApp(["modes"], t.io)
  expect(t.out.map((l) => l.split(" ")[0])).toEqual(["code", "plan", "ask", "advanced", "orchestrator", "security"])
  expect(t.out.find((l) => l.startsWith("plan"))).toContain("edit(\\.(md|mdx)$)")
  await runApp(["modes", "--json"], t.io)
  expect(JSON.parse(t.out.at(-1)!)[0]).toMatchObject({ slug: "code", name: "Code" })
})

describe("attach", () => {
  test("connects the client to a running server", async () => {
    const serverIo = io()
    let url = ""
    const password = "attach-test-password-123"
    let release!: () => void
    const stopped = new Promise<void>((r) => (release = r))
    const serving = runApp(["serve"], {
      ...serverIo.io,
      env: { ...serverIo.io.env, BOBI_SERVER_PASSWORD: password },
      out: (l) => void (url = JSON.parse(l).url),
      untilStopped: () => stopped,
    })
    while (!url) await Bun.sleep(20)
    const t = io()
    const env = { ...t.io.env, BOBI_SERVER_PASSWORD: password }
    expect(await runApp(["attach", url, "run", "hi"], { ...t.io, env })).toBe(0)
    expect(t.spawned[0]!.argv).toContain("run")
    expect(t.spawned[0]!.argv.at(-1)).toBe(url)
    expect(await runApp(["attach", url], { ...t.io, env: { ...env, BOBI_SERVER_PASSWORD: "wrong-password-but-long" } })).toBe(2)
    expect(t.err.at(-1)).toContain("HTTP 401")
    release()
    expect(await serving).toBe(0)
  }, 60_000)

  test("needs a password and a reachable server", async () => {
    const t = io()
    expect(await runApp(["attach", "http://127.0.0.1:1"], t.io)).toBe(2)
    expect(t.err[0]).toContain("BOBI_SERVER_PASSWORD")
    expect(await runApp(["attach", "http://127.0.0.1:1"], { ...t.io, env: { ...t.io.env, BOBI_SERVER_PASSWORD: "x".repeat(20) } })).toBe(2)
    expect(t.err[1]).toContain("no connection")
  })
})

test("clientSpec drops unset variables and appends the server URL", () => {
  const spec = clientSpec(["run", "x"], { url: "http://127.0.0.1:1", password: "p" }, { home: "/h" } as never, "/project", { A: "1", B: undefined, PWD: "/elsewhere" })
  expect(spec.env.PWD).toBe("/project")
  expect(spec.env.A).toBe("1")
  expect("B" in spec.env).toBe(false)
  expect(spec.argv.slice(-2)).toEqual(["--server", "http://127.0.0.1:1"])
  expect(spec.env.OPENCODE_PASSWORD).toBe("p")
})

test("bobi audit renders the local audit log as Markdown or JSON", async () => {
  const { mkdir, writeFile } = await import("node:fs/promises")
  const auditHome = await mkdtemp(path.join(tmpdir(), "bobi-audit-home-"))
  try {
    const t = io({ env: { BOBI_HOME: auditHome } })
    expect(await runApp(["audit"], t.io)).toBe(0)
    expect(t.err[0]).toContain("no audit records")
    await mkdir(path.join(auditHome, "audit"))
    const at = Date.parse("2026-10-19T10:00:00Z")
    const base = { "bobi.user": "anna", "bobi.mode": "code", "bobi.session": "s1" }
    const lines = [
      { name: "bobi.permission", start: at, end: at, attributes: { ...base, "bobi.action": "shell", "bobi.resources": "npm test", "bobi.result": "ask" } },
      { name: "bobi.approval", start: at + 1, end: at + 1, attributes: { ...base, "bobi.action": "shell", "bobi.resources": "npm test", "bobi.result": "once" } },
      { name: "bobi.tool", start: at + 2, end: at + 3, attributes: { ...base, "bobi.tool": "shell", "bobi.result": "completed" } },
    ]
    await writeFile(path.join(auditHome, "audit", "2026-10-19.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"))
    const md = io({ env: { BOBI_HOME: auditHome } })
    expect(await runApp(["audit", "--from", "2026-10-19"], md.io)).toBe(0)
    expect(md.out[0]).toContain("# Bobi audit report")
    expect(md.out[0]).toContain("| shell | 1 | 0 |")
    const json = io({ env: { BOBI_HOME: auditHome } })
    await runApp(["audit", "--format", "json", "--user", "anna"], json.io)
    expect(JSON.parse(json.out[0]!).totals).toMatchObject({ users: 1, sessions: 1, toolCalls: 1 })
  } finally {
    await rm(auditHome, { recursive: true, force: true })
  }
})

test("bobi diagram prints Mermaid for code and COBOL projects", async () => {
  const repo = path.resolve(import.meta.dir, "..", "..", "..")
  const code = io()
  expect(await runApp(["diagram", "--depth", "1", path.join(repo, "mcp-servers", "code-graph", "test", "fixture")], code.io)).toBe(0)
  expect(code.out[0]).toStartWith("flowchart LR")
  const cobolDir = path.join(repo, "mcp-servers", "cobol", "test", "fixture")
  const system = io()
  expect(await runApp(["diagram", "cobol", cobolDir], system.io)).toBe(0)
  expect(system.out[0]).toContain("PAYCALC -->|call| TAXCALC")
  const one = io()
  expect(await runApp(["diagram", "cobol", "--program", "paycalc", cobolDir], one.io)).toBe(0)
  expect(one.out[0]).toContain("flowchart TD")
  await expect(runApp(["diagram", "cobol", "--program", "NOPE", cobolDir], io().io)).rejects.toThrow(UsageError)
})

test("bobi usage reports tasks and tokens per person and team, with the configured estimate", async () => {
  const { mkdir, writeFile } = await import("node:fs/promises")
  const usageHome = await mkdtemp(path.join(tmpdir(), "bobi-usage-home-"))
  try {
    await mkdir(path.join(usageHome, "audit"))
    await writeFile(path.join(usageHome, "config.jsonc"), JSON.stringify({ usage: { minutesPerTask: 30 } }))
    const at = Date.parse("2026-10-20T10:00:00Z")
    const base = { "bobi.user": "anna", "bobi.team": "payments", "bobi.mode": "code", "bobi.session": "s1" }
    const lines = [
      { name: "bobi.task", start: at, end: at, attributes: { ...base, "bobi.result": "started" } },
      { name: "bobi.usage", start: at, end: at, attributes: { ...base, "bobi.result": "recorded", "bobi.tokens.input": 1000, "bobi.tokens.output": 200 } },
    ]
    await writeFile(path.join(usageHome, "audit", "2026-10-20.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"))
    const md = io({ env: { BOBI_HOME: usageHome } })
    expect(await runApp(["usage"], md.io)).toBe(0)
    expect(md.out[0]).toContain("| anna (payments) | 1 | 1 | 1,000 | 200 | 1,200 | 0 | 0 | 0 | 0.5 h |")
    const json = io({ env: { BOBI_HOME: usageHome } })
    await runApp(["usage", "--team", "other", "--format", "json"], json.io)
    expect(JSON.parse(json.out[0]!).total.tasks).toBe(0)
    const none = io({ env: { BOBI_HOME: usageHome } })
    await runApp(["usage", "--from", "2027-01-01"], none.io)
    expect(none.err[0]).toContain("no audit records")
  } finally {
    await rm(usageHome, { recursive: true, force: true })
  }
})
