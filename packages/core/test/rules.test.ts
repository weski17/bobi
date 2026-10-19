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

test("skips cache files, follows symlinked directories once and handles loops", () => {
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

test("rulesPrompt names project files relatively and global files absolutely", () => {
  const project = path.join(root, "p")
  const text = rulesPrompt([{ path: path.join(project, "AGENTS.md"), content: "x" }, { path: "/home/u/.bobi/rules/g.md", content: "y" }], project)!
  expect(text).toContain("## AGENTS.md\n\nx")
  expect(text).toContain("## /home/u/.bobi/rules/g.md\n\ny")
  expect(rulesPrompt([], project)).toBeUndefined()
})
