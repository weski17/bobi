// The chat controller against a real Bobi server (engine + bobi.core) and the mock model – no IDE needed.
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { DEFAULTS } from "@bobi/config"
import { startMockModel, type MockModel } from "@bobi/mock-model"
import { bobiPaths, startBobiServer, type BobiServer } from "@bobi/server"
import { BobiClient, type PermissionRequest } from "../src/client.ts"
import { ChatController, type ToUi, type UiPort } from "../src/controller.ts"
import { applyPatch } from "../src/patch.ts"

const password = "controller-test-password-1"
let mock: MockModel
let server: BobiServer
let home: string
let dir: string
let posts: ToUi[]
let diffs: PermissionRequest[]
let controller: ChatController

const ui: UiPort = {
  post: (m) => void posts.push(m),
  showDiff: async (r) => void diffs.push(r),
  error: (m) => void posts.push({ type: "error", message: m }),
}

const until = async (check: () => boolean | Promise<boolean>, ms = 15_000) => {
  const end = Date.now() + ms
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out; posts: ${JSON.stringify(posts).slice(0, 800)}`)
    await Bun.sleep(25)
  }
}

beforeAll(async () => {
  mock = startMockModel()
  home = await mkdtemp(path.join(tmpdir(), "bobi-ide-home-"))
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "bobi-ide-proj-")))
  Bun.spawnSync(["git", "init", "-q"], { cwd: dir })
  await writeFile(path.join(dir, "app.ts"), "export const answer = 41\n")
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "add", "."], { cwd: dir })
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"], { cwd: dir })
  process.env.BOBI_MODEL_API_KEY = "ide-test"
  server = await startBobiServer({
    config: { ...structuredClone(DEFAULTS), model: { ...DEFAULTS.model, baseURL: mock.baseURL, default: "mock-model" }, telemetry: { user: "ide" } },
    paths: bobiPaths({ BOBI_HOME: home }),
    password,
    browser: false,
  })
})
afterAll(async () => {
  controller?.stop()
  await server.stop()
  await mock.stop()
  await rm(home, { recursive: true, force: true })
  await rm(dir, { recursive: true, force: true })
})
beforeEach(async () => {
  controller?.stop()
  mock.clear()
  posts = []
  diffs = []
  controller = new ChatController(new BobiClient(server.url, password), dir, ui)
  await controller.start()
})

test("lists Bobi's modes in their usual order, starting in Code", () => {
  const ready = posts.find((p) => p.type === "ready") as Extract<ToUi, { type: "ready" }>
  expect(ready.modes.map((m) => m.id).slice(0, 5)).toEqual(["code", "plan", "ask", "advanced", "orchestrator"])
  expect(ready.mode).toBe("code")
})

test("streams the answer and reports when the request is done", async () => {
  mock.enqueue({ text: "Hello from Bobi in the IDE." })
  await controller.send("hi", [{ uri: `file://${dir}/app.ts`, name: "app.ts" }])
  await until(() => posts.some((p) => p.type === "busy" && !p.busy))
  expect(posts.filter((p) => p.type === "text").map((p) => (p as { delta: string }).delta).join("")).toBe("Hello from Bobi in the IDE.")
  expect(posts.find((p) => p.type === "user")).toEqual({ type: "user", text: "hi", context: ["app.ts"] })
})

test("an edit shows the proposed diff first and is applied only after approval", async () => {
  const file = path.join(dir, "app.ts")
  mock.enqueue({ toolCalls: [{ name: "edit", arguments: { path: file, oldString: "41", newString: "42" } }] }, { text: "Fixed." })
  await controller.send("fix the answer")
  await until(() => diffs.length > 0)
  const approval = posts.find((p) => p.type === "approval") as Extract<ToUi, { type: "approval" }>
  expect(approval).toMatchObject({ action: "edit", diff: true })
  expect(posts.find((p) => p.type === "tool")).toMatchObject({ name: "edit", summary: file })
  const preview = diffs[0]!.metadata!.files![0]!
  expect(applyPatch(await readFile(file, "utf8"), preview.patch)).toBe("export const answer = 42\n")
  expect(await readFile(file, "utf8")).toBe("export const answer = 41\n")
  await controller.reply(approval.id, "once")
  expect(posts).toContainEqual({ type: "approval-done", id: approval.id, decision: "once" })
  // Undo right away: it waits until the request has finished.
  expect(await controller.undo()).toBe(true)
  expect(await readFile(file, "utf8")).toBe("export const answer = 41\n")
  // Apply again and undo after completion.
  mock.enqueue({ toolCalls: [{ name: "edit", arguments: { path: file, oldString: "41", newString: "42" } }] }, { text: "Fixed." })
  posts = []
  await controller.send("fix the answer again")
  await until(() => posts.some((p) => p.type === "approval"))
  await controller.reply((posts.find((p) => p.type === "approval") as { id: string }).id, "once")
  await until(() => posts.some((p) => p.type === "busy" && !p.busy))
  expect(await readFile(file, "utf8")).toBe("export const answer = 42\n")

  // One click undo restores the file.
  expect(await controller.undo()).toBe(true)
  expect(await readFile(file, "utf8")).toBe("export const answer = 41\n")
  expect(await controller.undo()).toBe(false)
}, 60_000)

test("a rejected edit leaves the file unchanged", async () => {
  const file = path.join(dir, "new.ts")
  mock.enqueue({ toolCalls: [{ name: "write", arguments: { path: file, content: "x" } }] }, { text: "ok" })
  await controller.send("create a file")
  await until(() => posts.some((p) => p.type === "approval"))
  const approval = posts.find((p) => p.type === "approval") as Extract<ToUi, { type: "approval" }>
  await controller.reply(approval.id, "reject")
  await until(() => posts.some((p) => p.type === "busy" && !p.busy))
  expect(existsSync(file)).toBe(false)
  await controller.reply(approval.id, "once") // already answered: ignored
}, 60_000)

test("switching mode applies to the session; new chat starts a fresh session", async () => {
  mock.enqueue({ text: "one" })
  await controller.send("first")
  await until(() => posts.some((p) => p.type === "busy" && !p.busy))
  const first = controller.currentSession
  await controller.setMode("ask")
  expect(posts).toContainEqual({ type: "mode", mode: "ask" })
  controller.newChat()
  expect(posts).toContainEqual({ type: "cleared" })
  mock.enqueue({ text: "two" })
  await controller.send("second")
  expect(controller.currentSession).not.toBe(first)
  await controller.send("   ")
  await controller.stopRequest()
}, 60_000)

test("events of other sessions are ignored", () => {
  posts = []
  controller.handle({ type: "session.text.delta", data: { sessionID: "ses_other", delta: "x" } })
  expect(posts).toEqual([])
})

test("approvals from delegated subtasks reach the user; their text does not", async () => {
  const file = path.join(dir, "sub.txt")
  mock.enqueue(
    { toolCalls: [{ name: "subagent", arguments: { agent: "code", description: "write", prompt: `create ${file}` } }] },
    { text: "CHILD-TEXT", toolCalls: [{ name: "write", arguments: { path: file, content: "sub" } }] },
    { text: "child done" },
    { text: "orchestrated" },
  )
  await controller.setMode("orchestrator")
  await controller.send("delegate")
  await until(() => posts.some((p) => p.type === "approval"))
  const approval = posts.find((p) => p.type === "approval") as Extract<ToUi, { type: "approval" }>
  expect(approval.action).toBe("edit")
  await controller.reply(approval.id, "once")
  await until(() => posts.some((p) => p.type === "text" && (p as { delta: string }).delta.includes("orchestrated")))
  expect(await readFile(file, "utf8")).toBe("sub")
  expect(posts.some((p) => p.type === "text" && (p as { delta: string }).delta.includes("CHILD-TEXT"))).toBe(false)
  expect(posts.some((p) => p.type === "tool" && (p as { name: string }).name === "write")).toBe(true)
}, 60_000)

test("writes a commit message from the staged diff; reading the diff asks in the panel", async () => {
  await writeFile(path.join(dir, "feature.ts"), "export const feature = true\n")
  Bun.spawnSync(["git", "add", "feature.ts"], { cwd: dir })
  mock.enqueue({ toolCalls: [{ name: "shell", arguments: { command: "git diff --staged" } }] }, { text: "```\nAdd feature flag\n\nEnables the new feature.\n```" })
  const before = posts.filter((p) => p.type === "approval").length
  const message = controller.commitMessage()
  // Shell commands always ask, read-only git too (security review 2026-11-19, K1).
  await until(() => posts.filter((p) => p.type === "approval").length > before)
  const approval = posts.filter((p) => p.type === "approval").at(-1) as Extract<ToUi, { type: "approval" }>
  expect(approval.resources.join(" ")).toContain("git diff --staged")
  await controller.reply(approval.id, "once")
  expect(await message).toBe("Add feature flag\n\nEnables the new feature.")
  expect(JSON.stringify(mock.requests.at(-1)!.body.messages)).toContain("feature.ts")
}, 60_000)
