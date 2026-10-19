import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { BobiIgnore } from "../src/bobiignore.ts"
import { filterGlob, filterGrep, renderGlob, renderGrep } from "../src/search-filter.ts"

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "bobi-search-"))
  writeFileSync(path.join(dir, ".bobiignore"), "secret/\n")
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

test("glob results lose ignored entries and say so", () => {
  const { entries, removed } = filterGlob([{ path: "a.ts" }, { path: "secret/b.ts" }], dir, new BobiIgnore(dir))
  expect(entries).toEqual([{ path: "a.ts" }])
  expect(renderGlob(entries, removed)).toBe("a.ts\n\n(1 result hidden by .bobiignore)")
  expect(renderGlob([], 2)).toBe("No files found\n\n(2 results hidden by .bobiignore)")
  expect(renderGlob([{ path: "x" }], 0)).toBe("x")
})

test("grep matches lose ignored files and are rendered like the engine does", () => {
  const matches = [
    { entry: { path: "a.ts" }, line: 1, text: "x" },
    { entry: { path: "a.ts" }, line: 2, text: "y" },
    { entry: { path: "b.ts" }, line: 3, text: "z" },
    { entry: { path: "secret/c.ts" }, line: 4, text: "s" },
  ]
  const kept = filterGrep(matches, dir, new BobiIgnore(dir))
  expect(kept.removed).toBe(1)
  expect(renderGrep(kept.matches, kept.removed)).toBe("Found 3 matches\na.ts:\n  Line 1: x\n  Line 2: y\n\nb.ts:\n  Line 3: z\n\n(1 result hidden by .bobiignore)")
  expect(renderGrep([], 0)).toBe("No matches found")
})
