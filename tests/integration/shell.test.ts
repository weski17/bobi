// End-to-end: the `bobi` application (own server with the engine and @bobi/core, engine terminal client) against the mock model.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startMockModel, type MockModel } from "@bobi/mock-model"

const CLI = path.resolve(import.meta.dir, "..", "..", "packages", "shell", "src", "cli.ts")
let mock: MockModel
let dir: string
let configDir: string

beforeAll(async () => {
  mock = startMockModel({ fallback: { text: "hello from the mock model" } })
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-shell-")))
  configDir = await mkdtemp(path.join(tmpdir(), "bobi-shell-oc-"))
})
afterAll(async () => {
  await mock.stop()
  await rm(dir, { recursive: true, force: true })
  await rm(configDir, { recursive: true, force: true })
})

async function bobi(...args: string[]) {
  const child = Bun.spawn(["bun", CLI, ...args], {
    cwd: dir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      BOBI_MODEL_BASE_URL: mock.baseURL,
      BOBI_MODEL: "mock-model",
      BOBI_MODEL_API_KEY: "shell-test",
      BOBI_HOME: configDir,
      NO_COLOR: "1",
    },
  })
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
  return { output: stdout + stderr, code }
}

test("bobi run answers through the configured model endpoint", async () => {
  const { output, code } = await bobi("run", "hello")
  expect(output).toContain("hello from the mock model")
  expect(code).toBe(0)
  expect(mock.requests.at(-1)!.headers.authorization).toBe("Bearer shell-test")
}, 90_000)

test("bobi run without a TTY rejects writes instead of performing them", async () => {
  const target = path.join(dir, "should-not-exist.txt")
  mock.enqueue({ toolCalls: [{ name: "write", arguments: { path: target, content: "x" } }] }, { text: "gave up" })
  const { output } = await bobi("run", "write a file")
  // On macOS temp dirs (/var -> /private/var) OpenCode asks for external_directory before edit;
  // either way an approval was required and auto-rejected.
  expect(output).toMatch(/permission requested: (edit|external_directory)/)
  expect(output).toContain("auto-rejecting")
  expect(existsSync(target)).toBe(false)
}, 90_000)

test("bobi refuses commands and flags that bypass its safeguards", async () => {
  for (const args of [["run", "--auto", "x"], ["run", "--server", "http://127.0.0.1:1", "x"], ["upgrade", "now"]]) {
    const { output, code } = await bobi(...args)
    expect(code).toBe(2)
    expect(output).toMatch(/^bobi: /m)
  }
}, 30_000)

test("bobi keeps its data under BOBI_HOME", () => {
  expect(existsSync(path.join(configDir, "data", "bobi.db"))).toBe(true)
})
