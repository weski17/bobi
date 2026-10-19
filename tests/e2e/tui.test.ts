// Drives the real Bobi terminal UI in a pseudo terminal and answers the approval prompt with the keyboard.
import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { startMockModel, type MockModel } from "@bobi/mock-model"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const DRIVER = path.join(import.meta.dir, "tui_driver.py")
const CLI = path.join(ROOT, "packages", "shell", "src", "cli.ts")

let mock: MockModel | undefined
let dir: string | undefined
afterEach(async () => {
  await mock?.stop()
  if (dir) await rm(dir, { recursive: true, force: true })
  mock = undefined
  dir = undefined
})

async function driveWrite(answer: string[], done: string) {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-tui-")))
  const file = path.join(dir, "pwned.txt")
  mock = startMockModel({ script: [{ toolCalls: [{ name: "write", arguments: { path: file, content: "from the agent" } }] }, { text: "finished" }] })
  const child = Bun.spawn(
    ["python3", "-I", DRIVER, dir, "wait:Ask anything", "type:write the file", "key:enter", "wait:Permission required", ...answer, `wait:${done}`],
    {
      env: {
        ...process.env,
        BOBI_TUI_CMD: JSON.stringify(["bun", CLI]),
        BOBI_MODEL_BASE_URL: mock.baseURL,
        BOBI_MODEL: "mock-model",
        BOBI_MODEL_API_KEY: "tui-test",
        BOBI_HOME: path.join(dir, ".bobi-home"),
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
  return { file, code, stderr }
}

test("the approval prompt blocks the write until the user answers, and Reject prevents it", async () => {
  // A plain rejection ends the agent's turn; the UI marks it as interrupted.
  const result = await driveWrite(["key:right", "key:right", "key:enter"], "interrupted")
  expect(result.code, result.stderr).toBe(0)
  expect(existsSync(result.file)).toBe(false)
}, 90_000)

test("Allow once lets the write through", async () => {
  const result = await driveWrite(["key:enter"], "finished")
  expect(result.code, result.stderr).toBe(0)
  expect(await readFile(result.file, "utf8")).toBe("from the agent")
}, 90_000)

test("the terminal UI starts in Code mode and Shift+Tab switches to the next Bobi mode", async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-tui-")))
  mock = startMockModel()
  const child = Bun.spawn(["python3", "-I", DRIVER, dir, "wait:Code", "key:shift-tab", "wait:Plan"], {
    env: {
      ...process.env,
      BOBI_TUI_CMD: JSON.stringify(["bun", CLI]),
      BOBI_MODEL_BASE_URL: mock.baseURL,
      BOBI_MODEL: "mock-model",
      BOBI_MODEL_API_KEY: "tui-test",
      BOBI_HOME: path.join(dir, ".bobi-home"),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
  expect(code, stderr).toBe(0)
}, 90_000)
