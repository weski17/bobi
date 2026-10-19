import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { BobiIgnore, blockedShellPath, patchPaths, shellWords } from "../src/bobiignore.ts"

let project: string
beforeEach(() => {
  project = mkdtempSync(path.join(tmpdir(), "bobi-ignore-"))
  writeFileSync(path.join(project, ".bobiignore"), "# secrets\n.env*\n!.env.example\nsecrets/\n*.pem\n")
})
afterEach(() => rmSync(project, { recursive: true, force: true }))

describe("BobiIgnore", () => {
  test("matches gitignore patterns including negation and directories", () => {
    const ig = new BobiIgnore(project)
    expect(ig.ignores(".env")).toBe(true)
    expect(ig.ignores(".env.local")).toBe(true)
    expect(ig.ignores(".env.example")).toBe(false)
    expect(ig.ignores("secrets")).toBe(true)
    expect(ig.ignores("secrets/db.txt")).toBe(true)
    expect(ig.ignores(path.join(project, "config", "tls.pem"))).toBe(true)
    expect(ig.ignores("src/index.ts")).toBe(false)
  })

  test("never ignores itself, the project root or paths outside the project", () => {
    const ig = new BobiIgnore(project)
    expect(ig.ignores(".bobiignore")).toBe(false)
    expect(ig.ignores(project)).toBe(false)
    expect(ig.ignores("/etc/hosts.pem")).toBe(false)
    expect(ig.ignores("../outside.pem")).toBe(false)
  })

  test("without a .bobiignore nothing is ignored, and changes are picked up", () => {
    const other = mkdtempSync(path.join(tmpdir(), "bobi-ignore-none-"))
    try {
      const ig = new BobiIgnore(other)
      expect(ig.ignores("a.pem")).toBe(false)
      writeFileSync(path.join(other, ".bobiignore"), "*.pem\n")
      expect(ig.ignores("a.pem")).toBe(true)
      writeFileSync(path.join(other, ".bobiignore"), "*.key\n")
      utimesSync(path.join(other, ".bobiignore"), new Date(), new Date(Date.now() + 5000))
      expect(ig.ignores("a.pem")).toBe(false)
      expect(ig.ignores("a.key")).toBe(true)
    } finally {
      rmSync(other, { recursive: true, force: true })
    }
  })

  test("explains the block", () => {
    expect(new BobiIgnore(project).message(path.join(project, ".env"))).toContain(".env is blocked by .bobiignore")
  })
})

describe("shell protection", () => {
  const ig = () => new BobiIgnore(project)

  test.each([
    ["cat .env", ".env"],
    ["cat 'secrets/db.txt'", "secrets/db.txt"],
    ["ls && head -n 5 config/tls.pem", "config/tls.pem"],
    ["echo hi | grep -i password .env.local", ".env.local"],
    ["sort < .env", ".env"],
    ["/usr/bin/cat .env", ".env"],
    ["cp secrets/key /tmp/x", "secrets/key"],
  ])("blocks %p", (command, blocked) => {
    expect(blockedShellPath(command, project, ig())).toBe(blocked)
  })

  test.each(["cat README.md", "ls -la", "cat .env.example", "npm test", "curl https://x/.env", "echo .env"])("allows %p", (command) => {
    expect(blockedShellPath(command, project, ig())).toBeUndefined()
  })

  test("splits commands and respects quotes and escapes", () => {
    expect(shellWords(`a "b c" 'd;e' f\\ g; h|i && j`)).toEqual([["a", "b c", "d;e", "f g"], ["h"], ["i"], ["j"]])
    expect(shellWords(`x "a\\"b" ""`)).toEqual([["x", 'a"b', ""]])
  })
})

test("patchPaths reads add, update, delete and move targets", () => {
  const patch = "*** Begin Patch\n*** Add File: a.txt\n+x\n*** Update File: src/b.ts\n*** Move to: src/c.ts\n*** Delete File: .env\n*** End Patch"
  expect(patchPaths(patch)).toEqual(["a.txt", "src/b.ts", "src/c.ts", ".env"])
})
