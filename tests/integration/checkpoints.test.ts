// Checkpoints (ADR-0006): changes made by the agent can be undone in one step.
import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
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

// OpenCode snapshots require git (vendor/opencode/packages/core/src/snapshot.ts: enabled()).
// Approach for non-git projects is an open decision, see docs/STATUS.md.
test.todo("in a project without git, revert restores files changed by the agent")
