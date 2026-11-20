import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { collectRules, rulesPrompt } from "../src/rules.ts"

let root: string
beforeEach(() => (root = realpathSync(mkdtempSync(path.join(tmpdir(), "bobi-rules-")))))
afterEach(() => rmSync(root, { recursive: true, force: true }))

test("AGENTS.md files are collected from the project root down to the location", () => {
  const project = path.join(root, "p")
  mkdirSync(path.join(project, "pkg", "sub"), { recursive: true })
  writeFileSync(path.join(project, "AGENTS.md"), "root")
  writeFileSync(path.join(project, "pkg", "AGENTS.md"), "pkg")
  writeFileSync(path.join(project, "pkg", "sub", "AGENTS.md"), "   ")
  const files = collectRules("code", { globalDir: path.join(root, "g"), project, location: path.join(project, "pkg", "sub") })
  expect(files.map((f) => f.content)).toEqual(["root", "pkg"])
})

test("skips cache files and symbolic links in project rules", () => {
  const project = path.join(root, "p")
  const rules = path.join(project, ".bobi", "rules")
  mkdirSync(path.join(rules, "deep"), { recursive: true })
  writeFileSync(path.join(rules, "a.md"), "A")
  writeFileSync(path.join(rules, ".DS_Store"), "x")
  writeFileSync(path.join(rules, "notes.log"), "x")
  writeFileSync(path.join(rules, "deep", "b.md"), "B")
  symlinkSync(rules, path.join(rules, "deep", "loop"))
  const files = collectRules("code", { globalDir: path.join(root, "g"), project })
  expect(files.map((f) => f.content)).toEqual(["A", "B"])
})

test("project rules never follow a link out of the project; global rules may (review 2026-11-19, M3)", () => {
  const project = path.join(root, "p")
  const globalDir = path.join(root, "g")
  mkdirSync(path.join(project, ".bobi", "rules"), { recursive: true })
  mkdirSync(path.join(globalDir, "rules"), { recursive: true })
  writeFileSync(path.join(root, "secret.env"), "TOKEN=x")
  writeFileSync(path.join(root, "shared.md"), "SHARED")
  symlinkSync(path.join(root, "secret.env"), path.join(project, ".bobi", "rules", "x.md"))
  symlinkSync(path.join(root, "secret.env"), path.join(project, "AGENTS.md"))
  symlinkSync(path.join(root, "shared.md"), path.join(globalDir, "rules", "shared.md"))
  const contents = collectRules("code", { globalDir, project }).map((f) => f.content)
  expect(contents).toEqual(["SHARED"])
})

test("rulesPrompt names project files relatively and global files absolutely", () => {
  const project = path.join(root, "p")
  const text = rulesPrompt([{ path: path.join(project, "AGENTS.md"), content: "x" }, { path: "/home/u/.bobi/rules/g.md", content: "y" }], project)!
  expect(text).toContain("## AGENTS.md\n\nx")
  expect(text).toContain("## /home/u/.bobi/rules/g.md\n\ny")
  expect(rulesPrompt([], project)).toBeUndefined()
})
