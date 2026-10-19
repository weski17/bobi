import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  editAllowed,
  editRestriction,
  hasGroup,
  hiddenTools,
  isMcpTool,
  loadModes,
  ModeError,
  modeDenyRules,
  modePrompt,
  parseModes,
  type Mode,
} from "../src/index.ts"

const mode = (groups: Mode["groups"], extra: Partial<Mode> = {}): Mode => ({ slug: "m", name: "M", roleDefinition: "r", groups, source: "t", ...extra })

describe("parseModes", () => {
  test("parses names, optional fields and edit restrictions", () => {
    const [m] = parseModes(
      `customModes:\n  - slug: docs\n    name: Docs\n    description: d\n    whenToUse: w\n    customInstructions: c\n    roleDefinition: r\n    groups:\n      - read\n      - - edit\n        - fileRegex: \\.md$\n          description: md only\n`,
      "f",
    )
    expect(m).toEqual({ slug: "docs", name: "Docs", description: "d", whenToUse: "w", customInstructions: "c", roleDefinition: "r", source: "f", groups: ["read", ["edit", { fileRegex: "\\.md$", description: "md only" }]] })
  })

  test("an empty file has no modes, a mode without groups gets no tools", () => {
    expect(parseModes("", "f")).toEqual([])
    expect(parseModes("customModes:\n  - slug: x\n    name: X\n    roleDefinition: r\n", "f")[0]!.groups).toEqual([])
  })

  test("reports every problem with its location", () => {
    const yaml = `customModes:
  - slug: Bad Slug
    roleDefinition: ""
    groups: [read, command, [edit, {}], [edit, { fileRegex: "(" }], [edit, { fileRegex: x, description: 1 }], 5]
    extra: 1
    whenToUse: 3
  - slug: dup
    name: A
    roleDefinition: r
  - slug: dup
    name: B
    roleDefinition: r
  - just a string
  - slug: g
    name: G
    roleDefinition: r
    groups: read
`
    try {
      parseModes(yaml, "custom.yaml")
      throw new Error("expected ModeError")
    } catch (error) {
      expect(error).toBeInstanceOf(ModeError)
      const issues = (error as ModeError).issues.join("\n")
      for (const fragment of [
        "customModes[0].slug",
        "customModes[0].name: required",
        "customModes[0].roleDefinition: required",
        'unknown group "command"',
        "edit restriction needs fileRegex",
        "invalid fileRegex",
        "description must be a string",
        'a group is a name or ["edit", { fileRegex }]',
        "customModes[0].extra: unknown key",
        "customModes[0].whenToUse: must be a string",
        'duplicate slug "dup"',
        "customModes[3]: must be an object",
        "customModes[4].groups: must be a list",
      ])
        expect(issues).toContain(fragment)
    }
  })

  test("rejects documents without a customModes list and invalid YAML", () => {
    expect(() => parseModes("modes: []", "f")).toThrow(/customModes list/)
    expect(() => parseModes("customModes: [unclosed", "f")).toThrow(/cannot parse YAML/)
  })
})

describe("loadModes", () => {
  let dir: string
  beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), "bobi-modes-"))))
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  test("built-in modes load in a stable order", () => {
    expect(loadModes({ globalDir: path.join(dir, "g"), project: path.join(dir, "p") }).map((m) => m.slug)).toEqual(["code", "plan", "ask", "advanced", "orchestrator"])
  })

  test("global then project files override by slug and add new modes", () => {
    mkdirSync(path.join(dir, "g"))
    mkdirSync(path.join(dir, "p", ".bobi"), { recursive: true })
    writeFileSync(path.join(dir, "g", "custom_modes.yaml"), "customModes:\n  - slug: ask\n    name: G\n    roleDefinition: r\n  - slug: extra\n    name: E\n    roleDefinition: r\n")
    writeFileSync(path.join(dir, "p", ".bobi", "custom_modes.yaml"), "customModes:\n  - slug: ask\n    name: P\n    roleDefinition: r\n")
    const modes = loadModes({ globalDir: path.join(dir, "g"), project: path.join(dir, "p") })
    expect(modes.find((m) => m.slug === "ask")!.name).toBe("P")
    expect(modes.map((m) => m.slug)).toEqual(["code", "plan", "ask", "advanced", "orchestrator", "extra"])
  })
})

describe("groups", () => {
  test("hasGroup and editRestriction", () => {
    const restricted = mode(["read", ["edit", { fileRegex: "\\.md$" }]])
    expect(hasGroup(restricted, "edit")).toBe(true)
    expect(editRestriction(restricted)).toEqual({ fileRegex: "\\.md$" })
    expect(editRestriction(mode(["edit", ["edit", { fileRegex: "x" }]]))).toBeUndefined()
    expect(editAllowed(restricted, "docs/a.md")).toBe(true)
    expect(editAllowed(restricted, "src\\a.ts")).toBe(false)
    expect(editAllowed(mode(["read"]), "a.md")).toBe(false)
    expect(editAllowed(mode(["edit"]), "any")).toBe(true)
  })

  test("deny rules cover every missing group", () => {
    const rules = modeDenyRules(mode(["read"]))
    for (const action of ["edit", "shell", "browser", "webfetch", "websearch", "subagent", "opencode_*", "*_*"])
      expect(rules).toContainEqual({ action, resource: "*", effect: "deny" })
    expect(rules.at(-1)).toEqual({ action: "external_directory", resource: "*", effect: "ask" })
    expect(modeDenyRules(mode(["read", "edit", "execute", "browser", "mcp", "subtask"]))).toEqual([])
  })

  test("a mode with edit but without MCP keeps engine worktree tools on approval", () => {
    expect(modeDenyRules(mode(["read", "edit"])).slice(-2)).toEqual([
      { action: "external_directory", resource: "*", effect: "ask" },
      { action: "opencode_*", resource: "*", effect: "ask" },
    ])
  })

  test("hidden tools", () => {
    const names = ["read", "write", "shell", "browser", "subagent", "question", "github_create_issue", "opencode_worktree_create", "opencode_session_rename"]
    expect(hiddenTools(mode(["read"]), names).sort()).toEqual(["browser", "github_create_issue", "opencode_worktree_create", "shell", "subagent", "write"])
    expect(hiddenTools(mode(["read", "edit", "execute", "browser", "mcp", "subtask"]), names)).toEqual([])
    expect(isMcpTool("codegraph_callers")).toBe(true)
    expect(isMcpTool("opencode_read_mcp_resource")).toBe(false)
  })

  test("mode prompt contains role, instructions and edit restriction", () => {
    const text = modePrompt(mode(["read", ["edit", { fileRegex: "\\.md$", description: "Markdown" }]], { name: "Plan", slug: "plan", customInstructions: " extra " }))
    expect(text).toBe("# Mode: Plan (plan)\n\nr\n\nextra\n\nYou may only edit files matching \\.md$ (Markdown).")
    expect(modePrompt(mode(["read", ["edit", { fileRegex: "x" }]]))).toEndWith("You may only edit files matching x.")
  })
})
