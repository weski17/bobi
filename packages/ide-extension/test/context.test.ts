import { expect, test } from "bun:test"
import { contextFiles, withSelection } from "../src/context.ts"

const root = "/work/project"

test("open tabs in the workspace become context files, active editor first, without duplicates", () => {
  const tabs = [
    { fsPath: "/work/project/src/a.ts", scheme: "file" },
    { fsPath: "/work/project/src/b ü.ts", scheme: "file" },
    { fsPath: "/work/project/src/a.ts", scheme: "file" },
    { fsPath: "/elsewhere/c.ts", scheme: "file" },
    { fsPath: "/work/project/untitled", scheme: "untitled" },
  ]
  expect(contextFiles(root, tabs, "/work/project/src/b ü.ts")).toEqual([
    { uri: "file:///work/project/src/b%20%C3%BC.ts", name: "src/b ü.ts" },
    { uri: "file:///work/project/src/a.ts", name: "src/a.ts" },
  ])
})

test("at most 20 tabs", () => {
  const tabs = Array.from({ length: 30 }, (_, i) => ({ fsPath: `/work/project/f${i}.ts`, scheme: "file" }))
  expect(contextFiles(root, tabs)).toHaveLength(20)
})

test("the selection is quoted before the question", () => {
  expect(withSelection("explain", root, { fsPath: "/work/project/a.ts", startLine: 3, endLine: 5, text: "x()" })).toBe("Selected in a.ts (lines 3-5):\n```\nx()\n```\n\nexplain")
  expect(withSelection("explain", root, { fsPath: "/work/project/a.ts", startLine: 3, endLine: 3, text: "x" })).toContain("(line 3)")
  expect(withSelection("explain", root, { fsPath: "/work/project/a.ts", startLine: 1, endLine: 1, text: "  " })).toBe("explain")
  expect(withSelection("explain", root)).toBe("explain")
  expect(withSelection("q", root, { fsPath: "/work/project/a.ts", startLine: 1, endLine: 2, text: "y".repeat(25_000) })).toContain("… (truncated)")
})
