import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ignoredPaths } from "../../scripts/bobiignore-paths.ts"

let dir: string
beforeEach(() => (dir = realpathSync(mkdtempSync(path.join(tmpdir(), "bobi-ignored-")))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

test("lists the topmost ignored files and directories, skipping .git", () => {
  mkdirSync(path.join(dir, "private", "deep"), { recursive: true })
  mkdirSync(path.join(dir, "src"))
  mkdirSync(path.join(dir, ".git"))
  writeFileSync(path.join(dir, ".bobiignore"), "private/\n*.pem\n")
  writeFileSync(path.join(dir, "private", "deep", "x.txt"), "x")
  writeFileSync(path.join(dir, "src", "tls.pem"), "k")
  writeFileSync(path.join(dir, "src", "a.ts"), "a")
  writeFileSync(path.join(dir, ".git", "c.pem"), "g")
  expect(ignoredPaths(dir).sort()).toEqual([`${path.join(dir, "private")}/`, path.join(dir, "src", "tls.pem")])
  expect(ignoredPaths(dir, 1)).toHaveLength(1)
})
