// End-to-end test of the Podman sandbox (ADR-0007). Runs only when podman and the bobi:dev image exist:
//   podman build -f sandbox/Containerfile -t bobi:dev . && bun test ./tests/sandbox
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { startMockModel, type MockModel } from "@bobi/mock-model"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const SCRIPT = path.join(ROOT, "sandbox", "bobi-sandbox.sh")
const CLI = path.join(ROOT, "packages", "shell", "src", "cli.ts")
const PORT = 4196

const available =
  Bun.spawnSync(["podman", "image", "exists", "localhost/bobi:dev"], { stderr: "ignore" }).exitCode === 0 &&
  Bun.spawnSync(["podman", "info"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0

let mock: MockModel
// The podman machine shares the user's home directory, not /var/folders, so the project lives under $HOME.
const project = path.join(os.homedir(), ".bobi-sandbox-test", `p-${process.pid}`)
const password = `sandbox-${crypto.randomUUID()}`
let env: Record<string, string>

const sh = (args: string[], extra: Record<string, string> = {}) => {
  const r = Bun.spawnSync(args, { env: { ...env, ...extra }, stdout: "pipe", stderr: "pipe", cwd: project })
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }
}

describe.skipIf(!available)("podman sandbox", () => {
  beforeAll(() => {
    mock = startMockModel({ hostname: "127.0.0.1", fallback: { text: "hello from the host model" } })
    mkdirSync(path.join(project, "private"), { recursive: true })
    writeFileSync(path.join(project, ".bobiignore"), "secret.txt\nprivate/\n")
    writeFileSync(path.join(project, "secret.txt"), "top-secret")
    writeFileSync(path.join(project, "private", "notes.txt"), "private-notes")
    writeFileSync(path.join(project, "AGENTS.md"), "SANDBOX-AGENTS-RULE")
    const port = new URL(mock.url).port
    env = {
      ...(process.env as Record<string, string>),
      BOBI_SERVER_PASSWORD: password,
      BOBI_SANDBOX_PORT: String(PORT),
      BOBI_MODEL_BASE_URL: `http://host.containers.internal:${port}/v1`,
      BOBI_MODEL: "mock-model",
      BOBI_MODEL_API_KEY: "sandbox-test",
      BOBI_EGRESS_ALLOW: `host.containers.internal:${port}`,
      BOBI_HOME: path.join(project, ".bobi-home"),
      NO_COLOR: "1",
    }
    const up = sh(["bash", SCRIPT, "up", project])
    if (up.code !== 0) throw new Error(`sandbox up failed:\n${up.out}`)
  }, 180_000)

  afterAll(async () => {
    sh(["bash", SCRIPT, "down"])
    await mock?.stop()
    rmSync(project, { recursive: true, force: true })
  }, 60_000)

  test("the server in the container answers through the allowed model endpoint", async () => {
    // --trust: the decision is stored on the host and read by the server through the read-only trust mount.
    const child = Bun.spawn(["bun", CLI, "attach", `http://127.0.0.1:${PORT}`, "run", "--trust", "hello"], { cwd: project, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" })
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
    expect(out + err).toContain("hello from the host model")
    expect(code).toBe(0)
    expect(mock.requests.at(-1)!.headers.authorization).toBe("Bearer sandbox-test")
    expect(JSON.stringify(mock.requests.at(-1)!.body.messages)).toContain("SANDBOX-AGENTS-RULE")
  }, 120_000)

  test("the server container cannot reach hosts outside the allowlist", () => {
    const viaProxy = sh(["podman", "exec", "bobi-server", "bun", "-e", 'const r = await fetch("https://example.com").catch((e) => ({ status: e.code ?? e.message })); console.log("status", r.status)'])
    expect(viaProxy.out).not.toContain("status 200")
    const direct = sh(["podman", "exec", "-e", "HTTPS_PROXY=", "-e", "https_proxy=", "bobi-server", "bun", "-e", 'const r = await fetch("https://example.com").catch((e) => ({ status: e.code ?? e.message })); console.log("status", r.status)'])
    expect(direct.out).not.toContain("status 200")
    const logs = sh(["podman", "logs", "bobi-egress"]).out
    expect(logs).toContain('"target":"example.com:443","allowed":false')
  }, 60_000)

  test("files excluded by .bobiignore are empty inside the container, even for shell commands", () => {
    expect(sh(["podman", "exec", "bobi-server", "cat", path.join(project, "secret.txt")]).out).not.toContain("top-secret")
    expect(sh(["podman", "exec", "bobi-server", "ls", "-A", path.join(project, "private")]).out.trim()).toBe("")
    // Writes go to /dev/null: the real file on the host stays untouched.
    sh(["podman", "exec", "bobi-server", "sh", "-c", `echo overwritten > ${path.join(project, "secret.txt")}`])
    expect(readFileSync(path.join(project, "secret.txt"), "utf8")).toBe("top-secret")
  }, 60_000)

  test("the hidden checkpoint repository of a non-git project resolves inside the container", () => {
    // `attach` created it on the host in the first test; the server must see the same repository.
    expect(sh(["podman", "exec", "bobi-server", "git", "-C", project, "log", "--format=%s", "-1"]).out.trim()).toBe("bobi: checkpoint repository")
  }, 60_000)

  test("the server runs unprivileged and sees only the project", () => {
    expect(sh(["podman", "exec", "bobi-server", "id", "-u"]).out.trim()).toBe("1000")
    expect(sh(["podman", "exec", "bobi-server", "ls", project]).code).toBe(0)
    expect(sh(["podman", "exec", "bobi-server", "ls", os.homedir()]).out).not.toContain("Documents")
  }, 60_000)
})
