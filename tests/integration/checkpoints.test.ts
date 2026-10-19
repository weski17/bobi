// Checkpoints (ADR-0006): changes made by the agent can be undone in one step.
import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { bobiPaths, ensureCheckpointRepo } from "@bobi/server"
import path from "node:path"
import { createHarness, type Harness } from "./harness.ts"

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const git = (cwd: string, ...args: string[]) => {
  const r = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } })
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
}

test("in a git project, revert restores files changed and created by the agent", async () => {
  h = await createHarness({ autoApprove: [{ action: "edit", resource: "*", modes: [] }] })
  const existing = path.join(h.dir, "existing.txt")
  const created = path.join(h.dir, "created.txt")
  await writeFile(existing, "v1")
  git(h.dir, "init", "-q")
  git(h.dir, "add", ".")
  git(h.dir, "commit", "-qm", "init")

  const sessionID = await h.prompt(
    "change files",
    { toolCalls: [{ name: "write", arguments: { path: existing, content: "v2" } }] },
    { toolCalls: [{ name: "write", arguments: { path: created, content: "new" } }] },
    { text: "done" },
  )
  await h.opencode.sessions.wait({ sessionID })
  expect(await readFile(existing, "utf8")).toBe("v2")
  expect(existsSync(created)).toBe(true)

  const messages = await h.opencode.message.list({ sessionID, order: "asc" })
  const user = messages.data.find((m: { type: string }) => m.type === "user") as { id: string }
  const staged = await h.opencode.sessions.revert.stage({ sessionID, messageID: user.id, files: true })
  expect(staged.files?.length).toBeGreaterThanOrEqual(1)
  expect(await readFile(existing, "utf8")).toBe("v1")
  expect(existsSync(created)).toBe(false)
  await h.opencode.sessions.revert.commit({ sessionID })
  expect(await readFile(existing, "utf8")).toBe("v1")
}, 60_000)

test("in a project without git, the hidden checkpoint repository makes revert work", async () => {
  h = await createHarness({ autoApprove: [{ action: "edit", resource: "*", modes: [] }] })
  const file = path.join(h.dir, "notes.txt")
  await writeFile(file, "original")
  const home = await mkdtemp(path.join(tmpdir(), "bobi-ckpt-home-"))
  try {
    expect(ensureCheckpointRepo(h.dir, bobiPaths({ BOBI_HOME: home })).kind).toBe("shadow")
    const sessionID = await h.prompt("edit", { toolCalls: [{ name: "write", arguments: { path: file, content: "changed" } }] }, { text: "done" })
    await h.opencode.sessions.wait({ sessionID })
    expect(await readFile(file, "utf8")).toBe("changed")
    const messages = await h.opencode.message.list({ sessionID, order: "asc" })
    const user = messages.data.find((m: { type: string }) => m.type === "user") as { id: string }
    await h.opencode.sessions.revert.stage({ sessionID, messageID: user.id, files: true })
    expect(await readFile(file, "utf8")).toBe("original")
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}, 60_000)
