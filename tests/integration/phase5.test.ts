// Phase 5: orchestrator delegation, skills, slash commands (incl. built-in /commit, /security-review).
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { createHarness, waitFor, type Harness } from "./harness.ts"

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const done = { text: "done" }
const agentRequests = (h: Harness) => h.mock.requests.filter((r) => (r.body.tools?.length ?? 0) > 0)
const lastUser = (h: Harness) => JSON.stringify(agentRequests(h).at(-1)!.body.messages.filter((m) => m.role === "user"))
const toolText = (h: Harness) => JSON.stringify(agentRequests(h).at(-1)!.body.messages.filter((m) => m.role === "tool"))
const agentOf = async (h: Harness, sessionID: string) =>
  ((await h.opencode.message.list({ sessionID })).data as { type: string; agent?: string }[]).find((m) => m.type === "assistant")?.agent

describe("orchestrator", () => {
  test("delegates a subtask to the code mode; the subtask's write still needs approval", async () => {
    h = await createHarness()
    const file = path.join(h.dir, "delegated.txt")
    const sessionID = await h.promptIn(
      "orchestrator",
      "build it",
      { toolCalls: [{ name: "subagent", arguments: { agent: "code", description: "write the file", prompt: `Create ${file}` } }] },
      { toolCalls: [{ name: "write", arguments: { path: file, content: "from the subtask" } }] },
      { text: "subtask done" },
      { text: "All subtasks finished." },
    )
    // The approval belongs to the child session.
    const child = await waitFor(async () => {
      const sessions = (await h!.opencode.sessions.list({ directory: h!.dir })).data as { id: string; parentID?: string }[]
      return sessions.find((s) => s.parentID === sessionID)?.id
    })
    const request = await waitFor(async () => (await h!.opencode.permission.list({ sessionID: child }))[0])
    expect(request.action).toBe("edit")
    expect(existsSync(file)).toBe(false)
    await h.opencode.permission.reply({ sessionID: child, requestID: request.id, decision: "once" })
    await h.opencode.sessions.wait({ sessionID })
    expect(await readFile(file, "utf8")).toBe("from the subtask")
    expect(await agentOf(h, child)).toBe("code")
    // The orchestrator was offered Bobi's modes as subagents, but not itself.
    const subagentTool = JSON.stringify(agentRequests(h)[0]!.body.tools)
    for (const mode of ["code", "plan", "ask", "security"]) expect(subagentTool).toContain(mode)
  }, 60_000)
})

describe("skills", () => {
  test("a global skill can be loaded; the engine's own skills are gone", async () => {
    h = await createHarness()
    await mkdir(path.join(h.globalDir, "skills", "review-guide"), { recursive: true })
    await writeFile(path.join(h.globalDir, "skills", "review-guide", "SKILL.md"), "---\nname: review-guide\ndescription: How we review code\n---\nALWAYS-CHECK-ERROR-HANDLING")
    const sessionID = await h.prompt(
      "review",
      { toolCalls: [{ name: "skill", arguments: { id: "review-guide" } }] },
      { toolCalls: [{ name: "skill", arguments: { id: "opencode" } }] },
      done,
    )
    await h.opencode.sessions.wait({ sessionID })
    const tools = toolText(h)
    expect(tools).toContain("ALWAYS-CHECK-ERROR-HANDLING")
    expect(tools).not.toContain("opencode.ai")
  }, 30_000)

  test("project skills need trust", async () => {
    h = await createHarness({}, [], { trusted: false })
    await mkdir(path.join(h.dir, ".bobi", "skills", "evil"), { recursive: true })
    await writeFile(path.join(h.dir, ".bobi", "skills", "evil", "SKILL.md"), "INJECTED-SKILL")
    const sessionID = await h.prompt("x", { toolCalls: [{ name: "skill", arguments: { id: "evil" } }] }, done)
    await h.opencode.sessions.wait({ sessionID })
    expect(toolText(h)).not.toContain("INJECTED-SKILL")
  }, 30_000)
})

describe("slash commands", () => {
  test("a project command expands its template and runs in its mode", async () => {
    h = await createHarness()
    await mkdir(path.join(h.dir, ".bobi", "commands"), { recursive: true })
    await writeFile(path.join(h.dir, ".bobi", "commands", "explain.md"), "---\ndescription: Explain a file\nmode: ask\n---\nExplain $ARGUMENTS to a new team member.")
    h.mock.enqueue(done)
    const session = await h.opencode.sessions.create({ location: { directory: h.dir } })
    await h.opencode.sessions.command({ sessionID: session.id, name: "explain", text: "src/app.ts" })
    await h.opencode.sessions.wait({ sessionID: session.id })
    expect(lastUser(h)).toContain("Explain src/app.ts to a new team member.")
    expect(await agentOf(h, session.id)).toBe("ask")
    const commands = (await h.opencode.command.list({ location: { directory: h.dir } })).data as { name: string }[]
    expect(commands.map((c) => c.name)).toEqual(expect.arrayContaining(["explain", "commit", "pr", "security-review", "init"]))
  }, 30_000)

  test("/security-review switches to the security mode", async () => {
    h = await createHarness()
    h.mock.enqueue(done)
    const session = await h.opencode.sessions.create({ location: { directory: h.dir } })
    await h.opencode.sessions.command({ sessionID: session.id, name: "security-review", text: "src/auth" })
    await h.opencode.sessions.wait({ sessionID: session.id })
    expect(lastUser(h)).toContain("Scope: src/auth")
    expect(await agentOf(h, session.id)).toBe("security")
    expect(JSON.stringify(agentRequests(h).at(-1)!.body.messages)).toContain("# Mode: Security (security)")
  }, 30_000)

  test("/commit reads the diff without asking and asks before committing", async () => {
    h = await createHarness()
    for (const args of [["init", "-q"], ["config", "user.email", "t@t"], ["config", "user.name", "t"]]) Bun.spawnSync(["git", ...args], { cwd: h.dir })
    await writeFile(path.join(h.dir, "a.txt"), "a\n")
    Bun.spawnSync(["git", "add", "a.txt"], { cwd: h.dir })
    h.mock.enqueue(
      { toolCalls: [{ name: "shell", arguments: { command: "git diff --staged" } }] },
      { toolCalls: [{ name: "shell", arguments: { command: 'git commit -m "Add a.txt"' } }] },
      { text: "Committed." },
    )
    const session = await h.opencode.sessions.create({ location: { directory: h.dir } })
    await h.opencode.sessions.command({ sessionID: session.id, name: "commit", text: "" })
    const request = await waitFor(async () => (await h!.opencode.permission.list({ sessionID: session.id }))[0])
    expect(request.action).toBe("shell")
    expect(request.resources.join(" ")).toContain("git commit")
    expect(toolText(h)).toContain("a.txt")
    await h.opencode.permission.reply({ sessionID: session.id, requestID: request.id, decision: "once" })
    await h.opencode.sessions.wait({ sessionID: session.id })
    expect(Bun.spawnSync(["git", "log", "--format=%s"], { cwd: h.dir }).stdout.toString().trim()).toBe("Add a.txt")
  }, 60_000)
})
