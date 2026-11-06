// End-to-end test of the demo image through compose.demo.yaml (ADR-0020). Runs only when `docker compose` works and
// the image exists:
//   docker build -f sandbox/Containerfile --target demo -t bobi-demo:local . && bun test ./tests/sandbox/demo.test.ts
// BOBI_DEMO_IMAGE selects the image (default bobi-demo:local). BOBI_DEMO_GENERATE=1 also runs a real agent turn with
// the bundled model (slow on CPUs; the CI runs it).
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import os from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const IMAGE = process.env.BOBI_DEMO_IMAGE ?? "bobi-demo:local"
const PORT = 7691
const CHAT_PORT = 7692
const NAME = `bobi-demo-test-${process.pid}`
const password = `demo-${crypto.randomUUID()}`
const GENERATE = process.env.BOBI_DEMO_GENERATE === "1"

const available =
  Bun.spawnSync(["docker", "compose", "version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0 &&
  Bun.spawnSync(["docker", "image", "inspect", IMAGE], { stdout: "ignore", stderr: "ignore" }).exitCode === 0

const env = () => ({ ...(process.env as Record<string, string>), BOBI_DEMO_IMAGE: IMAGE, DEMO_PASSWORD: password, DEMO_PORT: String(PORT), DEMO_CHAT_PORT: String(CHAT_PORT), DEMO_CPUS: String(Math.min(4, os.cpus().length)) })
const compose = (...args: string[]) => {
  const r = Bun.spawnSync(["docker", "compose", "-p", NAME, "-f", "compose.demo.yaml", ...args], { cwd: ROOT, env: env(), stdout: "pipe", stderr: "pipe" })
  return { code: r.exitCode, out: r.stdout.toString() + r.stderr.toString() }
}
const exec = (...args: string[]) => compose("exec", "-T", ...args)

/** Opens a ttyd session, types `keys` one after another and returns everything the terminal printed. */
async function terminal(steps: { send?: string; waitFor: string }[], timeoutMs = 90_000): Promise<string> {
  const token = Buffer.from(`demo:${password}`).toString("base64")
  // Browsers always send Origin; ttyd (started with -O) refuses cross-origin WebSocket connections.
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { protocols: ["tty"], headers: { authorization: `Basic ${token}`, origin: `http://127.0.0.1:${PORT}` } } as never)
  ws.binaryType = "arraybuffer"
  let screen = ""
  ws.onmessage = (event) => {
    const bytes = new Uint8Array(event.data as ArrayBuffer)
    if (String.fromCharCode(bytes[0]!) === "0") screen += new TextDecoder().decode(bytes.subarray(1))
  }
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve()
    ws.onerror = (e) => reject(new Error(`web terminal refused the connection: ${(e as ErrorEvent).message ?? e.type}`))
  })
  ws.send(JSON.stringify({ AuthToken: token, columns: 140, rows: 45 }))
  const deadline = Date.now() + timeoutMs
  for (const step of steps) {
    if (step.send) ws.send(`0${step.send}`)
    while (!screen.includes(step.waitFor)) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for "${step.waitFor}"; screen so far:\n${screen.slice(-1500)}`)
      await Bun.sleep(100)
    }
  }
  ws.close()
  return screen
}

describe.skipIf(!available)("demo image", () => {
  test("refuses to start without a strong enough password", () => {
    const r = Bun.spawnSync(["docker", "run", "--rm", "-e", "DEMO_PASSWORD=short", IMAGE], { stdout: "pipe", stderr: "pipe" })
    expect(r.exitCode).toBe(2)
    expect(r.stderr.toString()).toContain("at least 12 characters")
  }, 60_000)

  describe("running", () => {
    beforeAll(async () => {
      const up = compose("up", "-d")
      if (up.code !== 0) throw new Error(`compose up failed:\n${up.out}`)
      for (let i = 0; i < 300; i++) {
        const status = Bun.spawnSync(["docker", "inspect", "--format", "{{.State.Health.Status}}", `${NAME}-demo-1`], { stdout: "pipe" }).stdout.toString().trim()
        if (status === "healthy") return
        await Bun.sleep(1000)
      }
      throw new Error(`demo not healthy:\n${compose("logs", "--tail", "60").out}`)
    }, 400_000)

    afterAll(() => void compose("down", "-v"), 120_000)

    test("stays up once the model has loaded (the model warm-up job must not stop the container)", async () => {
      for (let i = 0; i < 240; i++) {
        if (exec("demo", "ollama", "ps").out.includes("qwen3")) break
        await Bun.sleep(1000)
      }
      expect(exec("demo", "ollama", "ps").out).toContain("qwen3:4b-instruct-2507-q4_K_M")
      await Bun.sleep(5000)
      const state = Bun.spawnSync(["docker", "inspect", "--format", "{{.RestartCount}} {{.State.Health.Status}}", `${NAME}-demo-1`], { stdout: "pipe" }).stdout.toString().trim()
      expect(state).toBe("0 healthy")
    }, 300_000)

    test("the web terminal needs the password", async () => {
      const base = `http://127.0.0.1:${PORT}/`
      expect((await fetch(base)).status).toBe(401)
      expect((await fetch(base, { headers: { authorization: `Basic ${btoa("demo:wrong-password-123")}` } })).status).toBe(401)
      const ok = await fetch(base, { headers: { authorization: `Basic ${btoa(`demo:${password}`)}` } })
      expect(ok.status).toBe(200)
      expect(ok.headers.get("content-type")).toContain("text/html")
    })

    test("the web chat needs the password, serves the page and reaches the Bobi server only through its allowlist", async () => {
      const base = `http://127.0.0.1:${CHAT_PORT}`
      const auth = { authorization: `Basic ${btoa(`demo:${password}`)}` }
      expect((await fetch(`${base}/`)).status).toBe(401)
      expect((await fetch(`${base}/api/agent`)).status).toBe(401)
      const page = await fetch(`${base}/`, { headers: auth })
      expect(page.status).toBe(200)
      expect(await page.text()).toContain("Bobi Chat")
      expect((await fetch(`${base}/main.js`, { headers: auth })).status).toBe(200)
      const config = (await (await fetch(`${base}/config.json`, { headers: auth })).json()) as { directory: string }
      expect(config.directory).toBe("/home/bun/ide/workspace")
      // The chat's own calls work (the gate adds the server's credentials) ...
      // The engine loads the modes a moment after the location boots; the chat waits for them the same way.
      let agents = ""
      for (let i = 0; i < 60 && !agents.includes("orchestrator"); i++) {
        const r = await fetch(`${base}/api/agent?location[directory]=${encodeURIComponent(config.directory)}`, { headers: auth })
        expect(r.status).toBe(200)
        agents = await r.text()
        if (!agents.includes("orchestrator")) await Bun.sleep(500)
      }
      expect(agents).toContain("orchestrator")
      // ... everything else of the engine's API does not.
      expect((await fetch(`${base}/api/session`, { headers: auth })).status).toBe(404)
      expect((await fetch(`${base}/api/config`, { headers: auth })).status).toBe(404)
    }, 60_000)

    test("a browser session shows the menu, the tips, code tips and the COBOL diagram", async () => {
      const screen = await terminal([
        { waitFor: "Auswahl:" },
        { send: "2\r", waitFor: "Das kannst du ausprobieren" },
        { send: "\r", waitFor: "Auswahl:" },
        { send: "3\r", waitFor: "[complexity]" },
        { send: "\r", waitFor: "Auswahl:" },
        { send: "4\r", waitFor: "flowchart LR" },
        { send: "\r", waitFor: "Auswahl:" },
        { send: "6\r", waitFor: '"name": "Bobi"' },
      ])
      expect(screen).toContain("Bobi Demo")
      expect(screen).toContain("[empty-catch]")
      expect(screen).toContain("PAYCALC")
      expect(screen).toContain('"protocolVersion"')
    }, 180_000)

    test("the bundled model is present and not reachable from outside; the container has no internet", () => {
      expect(exec("demo", "ollama", "list").out).toContain("qwen3:4b-instruct-2507-q4_K_M")
      const ports = Bun.spawnSync(["docker", "ps", "--filter", `name=${NAME}`, "--format", "{{.Names}} {{.Ports}}"], { stdout: "pipe" }).stdout.toString()
      expect(ports).toContain(`:${PORT}->7681`)
      expect(ports).toContain(`:${CHAT_PORT}->7682`)
      expect(ports).not.toContain("11434")
      expect(ports).not.toContain("4096")
      const probe = 'try { const r = await fetch("https://example.com", { signal: AbortSignal.timeout(5000) }); console.log("REACHED", r.status) } catch { console.log("blocked") }'
      expect(exec("demo", "bun", "-e", probe).out).toContain("blocked")
    }, 60_000)

    test("runs unprivileged on a read-only filesystem without capabilities", () => {
      expect(exec("demo", "id", "-u").out.trim()).toBe("1000")
      expect(exec("demo", "sh", "-c", "touch /opt/bobi/x 2>&1 || echo read-only").out).toContain("read-only")
      const inspect = Bun.spawnSync(["docker", "inspect", "--format", "{{.HostConfig.CapDrop}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.SecurityOpt}}", `${NAME}-demo-1`], { stdout: "pipe" }).stdout.toString()
      expect(inspect).toContain("[ALL] true [no-new-privileges:true]")
    })

    test.skipIf(!GENERATE)("the bundled model answers through Bobi (real agent turn)", () => {
      // In a project directory, like the browser session (without one Bobi would create a checkpoint repository in $HOME,
      // which is read-only here).
      const prepare = 'd="$(mktemp -d)" && cp -a /opt/demo/workspace/. "$d" && cd "$d" && git init -q -b main && git add -A && git -c user.name=t -c user.email=t@t commit -qm init && exec bobi --trust run --mode ask "$0"'
      const r = Bun.spawnSync(["docker", "compose", "-p", NAME, "-f", "compose.demo.yaml", "exec", "-T", "demo", "sh", "-c", prepare, "Was macht src/checkout.ts? Antworte in einem Satz."], {
        cwd: ROOT,
        env: env(),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 900_000,
      })
      expect(r.exitCode).toBe(0)
      expect(r.stdout.toString().trim().length).toBeGreaterThan(0)
    }, 1_000_000)
  })
})
