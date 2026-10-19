import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { BUILTIN_COMMANDS, expandTemplate, extensionDirs, frontmatter, readCommands, readSkills } from "../src/extensions.ts"

let dir: string
beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), "bobi-ext-"))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (rel: string, content: string) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
  writeFileSync(path.join(dir, rel), content)
}

test("frontmatter is optional and invalid YAML is ignored", () => {
  expect(frontmatter("---\ndescription: d\nmode: plan\n---\nbody")).toEqual({ data: { description: "d", mode: "plan" }, body: "body" })
  expect(frontmatter("no frontmatter")).toEqual({ data: {}, body: "no frontmatter" })
  expect(frontmatter("---\n: [bad\n---\nbody").data).toEqual({})
  expect(frontmatter("---\n- a list\n---\nbody").data).toEqual({})
})

test("skills: SKILL.md per directory, later sources win, invalid ones skipped", () => {
  write("g/review/SKILL.md", "---\nname: review\ndescription: global\n---\nGlobal body")
  write("p/review/SKILL.md", "---\ndescription: project\n---\nProject body")
  write("p/Bad Name/SKILL.md", "body")
  write("p/empty/SKILL.md", "---\nname: empty\n---\n")
  write("p/notes/README.md", "no skill")
  const skills = readSkills([path.join(dir, "g"), path.join(dir, "p"), path.join(dir, "missing")])
  expect(skills).toEqual([{ name: "review", description: "project", path: path.join(dir, "p/review/SKILL.md"), content: "Project body" }])
})

test("commands: markdown files with optional description and mode", () => {
  write("c/deploy-check.md", "---\ndescription: Check deploy\nmode: ask\n---\nCheck $ARGUMENTS now")
  write("c/plain.md", "Just do it")
  write("c/Bad.md", "x")
  write("c/empty.md", "---\ndescription: d\n---\n")
  write("c/notes.txt", "x")
  expect(readCommands([path.join(dir, "c")])).toEqual([
    { name: "deploy-check", description: "Check deploy", mode: "ask", template: "Check $ARGUMENTS now", path: path.join(dir, "c/deploy-check.md") },
    { name: "plain", description: undefined, mode: undefined, template: "Just do it", path: path.join(dir, "c/plain.md") },
  ])
})

test("templates take the user's text", () => {
  expect(expandTemplate("Check $ARGUMENTS now", " prod ")).toBe("Check prod now")
  expect(expandTemplate("Check $ARGUMENTS", "")).toBe("Check (none)")
  expect(expandTemplate("Do it", "carefully")).toBe("Do it\n\ncarefully")
  expect(expandTemplate("Do it", "")).toBe("Do it")
})

test("built-in commands and directory order; project only when trusted", () => {
  expect(readCommands([BUILTIN_COMMANDS]).map((c) => [c.name, c.mode])).toEqual([["commit", "code"], ["pr", "code"], ["security-review", "security"]])
  expect(extensionDirs("/g", "/p", true)).toEqual({ skills: ["/g/skills", "/p/.bobi/skills"], commands: [BUILTIN_COMMANDS, "/g/commands", "/p/.bobi/commands"] })
  expect(extensionDirs("/g", "/p", false)).toEqual({ skills: ["/g/skills"], commands: [BUILTIN_COMMANDS, "/g/commands"] })
})
