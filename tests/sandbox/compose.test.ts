// End-to-end test of the Docker Compose setup (compose.yaml). Runs only when `docker compose` works and the
// image exists:   docker compose build && bun test ./tests/sandbox/compose.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const CLI = path.join(ROOT, "packages", "shell", "src", "cli.ts")
const PORT = 4296
const NAME = `bobi-test-${process.pid}`
const available =
  Bun.spawnSync(["docker", "compose", "version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0 &&
  Bun.spawnSync(["docker", "image", "inspect", "bobi:1.1.0"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0

// Docker's VM shares the home directory, so the project lives under $HOME.
const project = path.join(os.homedir(), ".bobi-compose-test", `p-${process.pid}`)
const password = crypto.randomUUID()
const env = () => ({
  ...(process.env as Record<string, string>),
  BOBI_PROJECT: project,
  BOBI_SERVER_PASSWORD: password,
  BOBI_MODEL_BASE_URL: "http://mock-model:4001/v1",
  BOBI_PORT: String(PORT),
  NO_COLOR: "1",
})
const compose = (...args: string[]) => {
  const r = Bun.spawnSync(["docker", "compose", "-p", NAME, "-f", "compose.yaml", "-f", path.join(project, "..", `${NAME}.override.yaml`), ...args], { cwd: ROOT, env: env(), stdout: "pipe", stderr: "pipe" })
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }
}

describe.skipIf(!available)("docker compose", () => {
  beforeAll(async () => {
    mkdirSync(project, { recursive: true })
    for (const d of ["data/shadow", "trust"]) mkdirSync(path.join(os.homedir(), ".bobi", d), { recursive: true })
    Bun.spawnSync(["git", "init", "-q"], { cwd: project })
    writeFileSync(path.join(project, "app.ts"), "export const answer = 42\n")
    writeFileSync(path.join(project, ".bobiignore"), "secret.txt\n")
    writeFileSync(path.join(project, "secret.txt"), "top-secret")
    const masks = Bun.spawnSync(["bun", "sandbox/compose-masks.ts", project], { cwd: ROOT, stdout: "pipe" })
    writeFileSync(path.join(project, "..", `${NAME}.override.yaml`), masks.stdout)
    const up = compose("--profile", "demo", "up", "-d")
    if (up.code !== 0) throw new Error(`compose up failed:\n${up.out}`)
    for (let i = 0; i < 60; i++) {
      const ok = await fetch(`http://127.0.0.1:${PORT}/api/session`, { headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` } }).catch(() => undefined)
      if (ok?.status === 200) return
      await Bun.sleep(1000)
    }
    throw new Error(`server not ready:\n${compose("logs", "--tail", "40").out}`)
  }, 240_000)

  afterAll(() => {
    compose("--profile", "demo", "down", "-v")
    rmSync(path.join(os.homedir(), ".bobi-compose-test"), { recursive: true, force: true })
  }, 120_000)

  test("the server answers through the gateway, only with the password", async () => {
    expect((await fetch(`http://127.0.0.1:${PORT}/api/session`)).status).toBe(401)
    const run = Bun.spawnSync(["bun", CLI, "attach", `http://127.0.0.1:${PORT}`, "run", "Was macht app.ts?"], { cwd: project, env: env(), stdin: "ignore", stdout: "pipe", stderr: "pipe" })
    expect(run.stdout.toString()).toContain("mock reply to")
  }, 120_000)

  test("runs unprivileged; .bobiignore'd files are empty inside the container", () => {
    expect(compose("exec", "-T", "server", "id", "-u").out.trim()).toBe("1000")
    expect(compose("exec", "-T", "server", "cat", path.join(project, "secret.txt")).out).not.toContain("top-secret")
    expect(compose("exec", "-T", "server", "cat", path.join(project, "app.ts")).out).toContain("answer = 42")
  })

  test("the server has no direct internet and the proxy enforces the allowlist", () => {
    const probe = 'try { const r = await fetch("https://example.com", { signal: AbortSignal.timeout(5000) }); console.log("REACHED", r.status) } catch (e) { console.log("blocked") }'
    expect(compose("exec", "-T", "-e", "HTTPS_PROXY=", "-e", "https_proxy=", "server", "bun", "-e", probe).out).toContain("blocked")
    expect(compose("exec", "-T", "server", "bun", "-e", probe).out).toContain("blocked")
    expect(compose("logs", "egress").out).toContain('"target":"example.com:443","allowed":false')
  }, 60_000)
})
