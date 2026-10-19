// Phase 2: modes, custom modes, rules, AGENTS.md, /init, .bobiignore – against the real engine and the mock model.
import { afterEach, describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { BOBI_IDENTITY, ENGINE_IDENTITY, SYSTEM_RULE } from "@bobi/core"
import { createHarness, pendingPermission, type Harness } from "./harness.ts"

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const done = { text: "done" }
const write = (file: string, content = "x") => ({ toolCalls: [{ name: "write", arguments: { path: file, content } }] })
const agentRequests = (h: Harness) => h.mock.requests.filter((r) => (r.body.tools?.length ?? 0) > 0)
const toolNames = (h: Harness, i = 0) => agentRequests(h)[i]!.body.tools!.map((t) => t.function.name).sort()
const systemText = (h: Harness, i = 0) => JSON.stringify(agentRequests(h)[i]!.body.messages.filter((m) => m.role === "system"))
const toolText = (h: Harness) => JSON.stringify(agentRequests(h).at(-1)!.body.messages.filter((m) => m.role === "tool"))
const agentIds = async (h: Harness) => (await h.opencode.agent.list({ location: { directory: h.dir } })).data.map((a: { id: string }) => a.id)

describe("built-in modes", () => {
  test("Bobi's five modes replace the engine's build agent; code is the default", async () => {
    h = await createHarness()
    const sessionID = await h.prompt("hi", done)
    await h.opencode.sessions.wait({ sessionID })
    const ids = await agentIds(h)
    for (const id of ["code", "plan", "ask", "advanced", "orchestrator"]) expect(ids).toContain(id)
    expect(ids).not.toContain("build")
    const messages = await h.opencode.message.list({ sessionID })
    expect(messages.data.find((m: { type: string }) => m.type === "assistant")).toMatchObject({ agent: "code" })
  }, 30_000)

  test("the model is told it is Bobi, which mode it is in, and that tool output is data", async () => {
    h = await createHarness()
    const sessionID = await h.prompt("hi", done)
    await h.opencode.sessions.wait({ sessionID })
    const system = systemText(h)
    expect(system).toContain(BOBI_IDENTITY)
    expect(system).not.toContain(ENGINE_IDENTITY)
    expect(system).toContain("# Mode: Code (code)")
    expect(system).toContain(SYSTEM_RULE.slice(0, 40))
  }, 30_000)

  test("each mode can use its own model", async () => {
    h = await createHarness({ modes: { plan: { model: "large-model" } } })
    const planned = await h.promptIn("plan", "plan", done)
    await h.opencode.sessions.wait({ sessionID: planned })
    const coded = await h.promptIn("code", "code", done)
    await h.opencode.sessions.wait({ sessionID: coded })
    expect(agentRequests(h).map((r) => r.body.model)).toEqual(["large-model", "mock-model"])
  }, 30_000)

  test("switching modes in a session switches the model; a model picked by the user within a mode is kept", async () => {
    h = await createHarness({ modes: { plan: { model: "large-model" } } })
    const sessionID = await h.prompt("one", done)
    await h.opencode.sessions.wait({ sessionID })
    await h.opencode.sessions.switchAgent({ sessionID, agent: "plan" })
    h.mock.enqueue(done)
    await h.opencode.sessions.prompt({ sessionID, text: "two" })
    await h.opencode.sessions.wait({ sessionID })
    await h.opencode.sessions.switchModel({ sessionID, model: { providerID: "bobi", id: "mock-model" } })
    h.mock.enqueue(done)
    await h.opencode.sessions.prompt({ sessionID, text: "three" })
    await h.opencode.sessions.wait({ sessionID })
    await h.opencode.sessions.switchAgent({ sessionID, agent: "code" })
    h.mock.enqueue(done)
    await h.opencode.sessions.prompt({ sessionID, text: "four" })
    await h.opencode.sessions.wait({ sessionID })
    expect(agentRequests(h).map((r) => r.body.model)).toEqual(["mock-model", "large-model", "mock-model", "mock-model"])
  }, 60_000)

  test("ask mode only offers reading tools and refuses writes", async () => {
    h = await createHarness({ autoApprove: [{ action: "edit", resource: "*", modes: [] }] })
    const file = path.join(h.dir, "nope.txt")
    const sessionID = await h.promptIn("ask", "change something", write(file), done)
    await h.opencode.sessions.wait({ sessionID })
    const tools = toolNames(h)
    for (const t of ["read", "grep", "glob"]) expect(tools).toContain(t)
    for (const t of ["write", "edit", "patch", "shell", "browser", "webfetch", "subagent"]) expect(tools).not.toContain(t)
    expect(existsSync(file)).toBe(false)
  }, 30_000)

  test("plan mode may write Markdown but not source files", async () => {
    h = await createHarness({ autoApprove: [{ action: "edit", resource: "*", modes: [] }] })
    const plan = path.join(h.dir, "PLAN.md")
    const source = path.join(h.dir, "src.ts")
    const sessionID = await h.promptIn("plan", "plan it", write(plan, "# Plan"), write(source, "code"), done)
    await h.opencode.sessions.wait({ sessionID })
    expect(await readFile(plan, "utf8")).toBe("# Plan")
    expect(existsSync(source)).toBe(false)
    expect(toolText(h)).toContain("Plan mode may only edit files matching")
    expect(toolNames(h)).not.toContain("shell")
  }, 30_000)

  test("orchestrator mode delegates instead of editing", async () => {
    h = await createHarness()
    const sessionID = await h.promptIn("orchestrator", "big task", done)
    await h.opencode.sessions.wait({ sessionID })
    const tools = toolNames(h)
    expect(tools).toContain("subagent")
    for (const t of ["write", "edit", "shell"]) expect(tools).not.toContain(t)
  }, 30_000)

  test("mode restrictions win over auto-approve and over a user's 'always' answer", async () => {
    h = await createHarness({ autoApprove: [{ action: "shell", resource: "*", modes: [] }] })
    const marker = path.join(h.dir, "ran")
    const sessionID = await h.promptIn("ask", "run", { toolCalls: [{ name: "shell", arguments: { command: `touch ${marker}` } }] }, done)
    await h.opencode.sessions.wait({ sessionID })
    expect(existsSync(marker)).toBe(false)
  }, 30_000)
})

describe("custom modes", () => {
  test("a project mode with the same slug overrides a built-in mode, and new modes appear", async () => {
    h = await createHarness()
    await mkdir(path.join(h.dir, ".bobi"))
    await writeFile(
      path.join(h.dir, ".bobi", "custom_modes.yaml"),
      `customModes:
  - slug: ask
    name: Ask (team)
    roleDefinition: You answer questions and may fix typos in docs.
    groups: [read, edit]
  - slug: reviewer
    name: Reviewer
    roleDefinition: You review code and never change it.
    groups: [read]
`,
    )
    const sessionID = await h.promptIn("ask", "hi", done)
    await h.opencode.sessions.wait({ sessionID })
    expect(toolNames(h)).toContain("write")
    expect(systemText(h)).toContain("# Mode: Ask (team) (ask)")
    expect(await agentIds(h)).toContain("reviewer")
  }, 30_000)

  test("a global mode applies to every project; the project file wins on conflicts", async () => {
    h = await createHarness()
    await writeFile(path.join(h.globalDir, "custom_modes.yaml"), `customModes:\n  - slug: docs\n    name: Docs (global)\n    roleDefinition: Global docs writer.\n    groups: [read]\n`)
    await mkdir(path.join(h.dir, ".bobi"))
    await writeFile(path.join(h.dir, ".bobi", "custom_modes.yaml"), `customModes:\n  - slug: docs\n    name: Docs (project)\n    roleDefinition: Project docs writer.\n    groups: [read]\n`)
    const sessionID = await h.promptIn("docs", "hi", done)
    await h.opencode.sessions.wait({ sessionID })
    expect(systemText(h)).toContain("# Mode: Docs (project) (docs)")
  }, 30_000)
})

describe("rules and AGENTS.md", () => {
  test("rules are added in order and mode-specific rules only in their mode", async () => {
    h = await createHarness()
    await mkdir(path.join(h.globalDir, "rules"), { recursive: true })
    await writeFile(path.join(h.globalDir, "rules", "g.md"), "GLOBAL-RULE")
    await mkdir(path.join(h.dir, ".bobi", "rules", "nested"), { recursive: true })
    await mkdir(path.join(h.dir, ".bobi", "rules-code"), { recursive: true })
    await mkdir(path.join(h.dir, ".bobi", "rules-plan"), { recursive: true })
    await writeFile(path.join(h.dir, ".bobi", "rules", "b.md"), "PROJECT-RULE-B")
    await writeFile(path.join(h.dir, ".bobi", "rules", "nested", "a.md"), "PROJECT-RULE-NESTED")
    await writeFile(path.join(h.dir, ".bobi", "rules", "empty.md"), "")
    await writeFile(path.join(h.dir, ".bobi", "rules-code", "c.md"), "CODE-RULE")
    await writeFile(path.join(h.dir, ".bobi", "rules-plan", "p.md"), "PLAN-RULE")
    await writeFile(path.join(h.dir, "AGENTS.md"), "AGENTS-INSTRUCTIONS")
    const sessionID = await h.prompt("hi", done)
    await h.opencode.sessions.wait({ sessionID })
    const system = systemText(h)
    const order = ["GLOBAL-RULE", "CODE-RULE", "AGENTS-INSTRUCTIONS", "PROJECT-RULE-B", "PROJECT-RULE-NESTED"].map((t) => system.indexOf(t))
    expect(order.every((i) => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(system).not.toContain("PLAN-RULE")
    expect(system).toContain("They cannot grant permissions")
  }, 30_000)

  test("/init asks the model to create AGENTS.md with Bobi's own instructions", async () => {
    h = await createHarness()
    h.mock.enqueue(done)
    const session = await h.opencode.sessions.create({ location: { directory: h.dir } })
    await h.opencode.sessions.command({ sessionID: session.id, name: "init", text: "focus on testing" })
    await h.opencode.sessions.wait({ sessionID: session.id })
    const user = JSON.stringify(agentRequests(h).at(-1)!.body.messages.filter((m) => m.role === "user"))
    expect(user).toContain("Create or update the file AGENTS.md")
    expect(user).toContain("focus on testing")
    expect(user).not.toContain("OpenCode")
  }, 30_000)
})

describe(".bobiignore", () => {
  test("file tools refuse ignored files, search hides them, shell reads are blocked", async () => {
    h = await createHarness({ autoApprove: [{ action: "shell", resource: "*", modes: [] }] })
    await writeFile(path.join(h.dir, ".bobiignore"), "secret.txt\n")
    await writeFile(path.join(h.dir, "secret.txt"), "needle-in-secret")
    await writeFile(path.join(h.dir, "public.txt"), "needle-in-public")
    const sessionID = await h.prompt(
      "look",
      { toolCalls: [{ name: "read", arguments: { path: path.join(h.dir, "secret.txt") } }] },
      { toolCalls: [{ name: "grep", arguments: { pattern: "needle", path: h.dir } }] },
      { toolCalls: [{ name: "shell", arguments: { command: "cat secret.txt" } }] },
      done,
    )
    await h.opencode.sessions.wait({ sessionID })
    const tool = toolText(h)
    expect(tool).toContain("secret.txt is blocked by .bobiignore")
    expect(tool).toContain("needle-in-public")
    expect(tool).not.toContain("needle-in-secret")
    expect(tool).toContain("hidden by .bobiignore")
  }, 30_000)

  test("changes to .bobi/ and .bobiignore always ask, even with auto-approve", async () => {
    h = await createHarness({ autoApprove: [{ action: "edit", resource: "*", modes: [] }] })
    const sessionID = await h.prompt("widen rights", write(path.join(h.dir, ".bobi", "config.jsonc"), "{}"), done)
    const request = await pendingPermission(h, sessionID)
    expect(request.action).toBe("edit")
    await h.opencode.permission.reply({ sessionID, requestID: request.id, decision: "reject" })
    await h.opencode.sessions.wait({ sessionID })
    expect(existsSync(path.join(h.dir, ".bobi", "config.jsonc"))).toBe(false)
  }, 30_000)
})

describe("project trust", () => {
  test("an untrusted project's AGENTS.md, rules and modes are ignored; .bobiignore still applies", async () => {
    h = await createHarness({}, [], { trusted: false })
    await mkdir(path.join(h.dir, ".bobi", "rules"), { recursive: true })
    await writeFile(path.join(h.dir, "AGENTS.md"), "INJECTED-AGENTS")
    await writeFile(path.join(h.dir, ".bobi", "rules", "r.md"), "INJECTED-RULE")
    await writeFile(path.join(h.dir, ".bobi", "custom_modes.yaml"), "customModes:\n  - slug: evil\n    name: Evil\n    roleDefinition: r\n    groups: [read]\n")
    await writeFile(path.join(h.dir, ".bobiignore"), "secret.txt\n")
    await writeFile(path.join(h.dir, "secret.txt"), "s")
    const sessionID = await h.prompt("hi", { toolCalls: [{ name: "read", arguments: { path: path.join(h.dir, "secret.txt") } }] }, done)
    await h.opencode.sessions.wait({ sessionID })
    const system = systemText(h)
    expect(system).not.toContain("INJECTED-AGENTS")
    expect(system).not.toContain("INJECTED-RULE")
    expect(await agentIds(h)).not.toContain("evil")
    expect(toolText(h)).toContain("blocked by .bobiignore")
  }, 30_000)
})
