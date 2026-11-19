import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { evaluate, loadDefaultPolicy, rulesForAgent, wildcard, writesFile, type Rule } from "../src/permissions.ts"

// What OpenCode gives every agent by default (packages/schema/src/agent.ts): allow everything.
const OPENCODE_DEFAULT: Rule[] = [
  { action: "*", resource: "*", effect: "allow" },
  { action: "read", resource: "*.env", effect: "ask" },
]
const policy = loadDefaultPolicy()
const effective = (agent = "code", autoApprove: Parameters<typeof rulesForAgent>[2] = []) => [...OPENCODE_DEFAULT, ...rulesForAgent(agent, policy, autoApprove)]

describe("default policy", () => {
  test("every write, shell command and network action asks", () => {
    const rules = effective()
    for (const [action, resource] of [
      ["edit", "/repo/src/a.ts"],
      ["shell", "rm -rf /"],
      ["shell", "git push"],
      ["webfetch", "https://example.com"],
      ["websearch", "query"],
      ["browser", "https://intranet"],
      ["external_directory", "/etc"],
      ["github_create_issue", "*"],
      ["opencode_read_mcp_resource", "res://x"],
    ])
      expect(evaluate(action!, resource!, rules)).toBe("ask")
  })

  test("reading and searching inside the project stay allowed", () => {
    const rules = effective()
    expect(evaluate("read", "/repo/src/a.ts", rules)).toBe("allow")
    expect(evaluate("grep", "/repo", rules)).toBe("allow")
    expect(evaluate("glob", "/repo", rules)).toBe("allow")
  })

  test("reading key material asks", () => {
    const rules = effective()
    for (const file of ["/repo/server.pem", "/repo/tls.key", "/home/u/.ssh/id_rsa", "/home/u/.ssh/id_ed25519.pub"])
      expect(evaluate("read", file, rules)).toBe("ask")
  })

  test("the policy never denies (engine denies are checked first) and allows nothing", () => {
    expect(policy.some((r) => r.effect === "deny")).toBe(false)
    expect(policy.some((r) => r.effect === "allow")).toBe(false)
  })
})

describe("git", () => {
  test("every git command asks, read-only ones too (review 2026-11-19, K1)", () => {
    const rules = effective()
    for (const cmd of ["git status", "git status --short", "git diff --staged", "git log -n 10 --format=%s", "git show HEAD", "git branch --show-current"])
      expect(evaluate("shell", cmd, rules)).toBe("ask")
  })

  test("the commands from the review that wrote, read ignored files or ran code ask", () => {
    const rules = effective()
    for (const cmd of ["git log > /tmp/x", "git show HEAD:payload > .git/config", "git diff --no-index .env /dev/null", "git show HEAD:.env", "git log >> .bobi/custom_modes.yaml"])
      expect(evaluate("shell", cmd, rules)).toBe("ask")
  })
})

describe("writesFile", () => {
  test("redirects into files count", () => {
    for (const cmd of ["git log > /tmp/x", "git log >> a", "git show HEAD:x >.git/config", "git log &> out", "git log >| x", "git log >&out", "git log >& out", "git log>x;ls", "x 2> err.txt"])
      expect(writesFile(cmd)).toBe(true)
  })

  test("descriptors, /dev/null and plain commands do not", () => {
    for (const cmd of ["git status", "git status 2>&1", "git status 2>/dev/null", "git diff 2>&1 | head", "ls 1>&2", "cat < in", "git status 2>&1 >/dev/null"])
      expect(writesFile(cmd)).toBe(false)
  })
})

describe("auto-approve", () => {
  test("explicit rules allow matching actions only", () => {
    const rules = effective("code", [{ action: "shell", resource: "git status *", modes: [] }])
    expect(evaluate("shell", "git status", rules)).toBe("allow")
    expect(evaluate("shell", "git status --short", rules)).toBe("allow")
    expect(evaluate("shell", "git push", rules)).toBe("ask")
  })

  test("mode-restricted rules apply only to those modes", () => {
    const approve = [{ action: "edit" as const, resource: "/repo/docs/*", modes: ["code"] }]
    expect(evaluate("edit", "/repo/docs/a.md", effective("code", approve))).toBe("allow")
    expect(evaluate("edit", "/repo/docs/a.md", effective("plan", approve))).toBe("ask")
  })

  test("mcp approvals name the MCP tool", () => {
    const rules = effective("advanced", [{ action: "mcp", resource: "codegraph_*", modes: [] }])
    expect(evaluate("codegraph_callers", "*", rules)).toBe("allow")
    expect(evaluate("github_create_issue", "*", rules)).toBe("ask")
  })

  test("every Bobi action maps to an OpenCode action", () => {
    for (const action of ["edit", "shell", "webfetch", "browser", "external_directory"] as const) {
      const [rule] = rulesForAgent("x", [], [{ action, resource: "r", modes: [] }])
      expect(rule).toEqual({ action, resource: "r", effect: "allow" })
    }
  })
})

describe("wildcard", () => {
  test("mirrors OpenCode semantics", () => {
    expect(wildcard("a.ts", "*.ts")).toBe(true)
    expect(wildcard("a.tsx", "*.ts")).toBe(false)
    expect(wildcard("ab", "a?")).toBe(true)
    expect(wildcard("C:\\repo\\a.ts", "C:/repo/*")).toBe(true)
    expect(wildcard("a(b)", "a(b)")).toBe(true)
    expect(wildcard("npm test", "npm test *")).toBe(true)
  })

  test("no matching rule means ask", () => {
    expect(evaluate("anything", "x", [])).toBe("ask")
  })
})

describe("loadDefaultPolicy", () => {
  test("rejects malformed policy files", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "bobi-policy-"))
    try {
      writeFileSync(path.join(dir, "a.jsonc"), `{ "action": "edit" }`)
      expect(() => loadDefaultPolicy(path.join(dir, "a.jsonc"))).toThrow(/array/)
      writeFileSync(path.join(dir, "b.jsonc"), `[{ "action": "edit", "resource": "*", "effect": "maybe" }]`)
      expect(() => loadDefaultPolicy(path.join(dir, "b.jsonc"))).toThrow(/rule 0/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
