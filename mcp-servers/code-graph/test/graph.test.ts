import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { cpSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { CodeGraph, listSourceFiles } from "../src/graph.ts"
import { callPath, fileDependencies, findSymbols, QueryError, resolveFile, resolveSymbol, walkCalls } from "../src/queries.ts"

const FIXTURE = path.join(import.meta.dir, "fixture")
let graph: CodeGraph
beforeAll(() => (graph = CodeGraph.build(FIXTURE)))

const ids = (list: { symbol: { id: string } }[]) => list.map((r) => r.symbol.id)

describe("indexing", () => {
  test("indexes sources, skipping node_modules, build output and .bobiignore'd files", () => {
    expect(listSourceFiles(FIXTURE).map((f) => path.relative(FIXTURE, f))).toEqual(["src/legacy.js", "src/main.ts", "src/user.ts", "src/util/math.ts"])
  })

  test("finds functions, arrow functions, classes, methods and constructors", () => {
    for (const id of ["src/util/math.ts#add", "src/util/math.ts#double", "src/user.ts#UserService", "src/user.ts#UserService.score", "src/user.ts#UserService.save", "src/user.ts#UserService.constructor", "src/main.ts#main", "src/legacy.js#sum"])
      expect(graph.symbols.has(id)).toBe(true)
    expect(graph.symbols.get("src/user.ts#UserService.save")).toMatchObject({ name: "save", kind: "method", line: 8 })
  })

  test("records calls through imports, namespaces, this, new and require", () => {
    expect([...graph.calls.get("src/main.ts#main")!].sort()).toEqual(["src/user.ts#UserService.constructor", "src/user.ts#UserService.save", "src/util/math.ts#add"])
    expect([...graph.calls.get("src/user.ts#UserService.save")!]).toEqual(["src/user.ts#UserService.score"])
    expect([...graph.calls.get("src/user.ts#UserService.score")!]).toEqual(["src/util/math.ts#double"])
    expect([...graph.calls.get("src/util/math.ts#double")!]).toEqual(["src/util/math.ts#add"])
    expect([...graph.calls.get("src/legacy.js#sum")!]).toEqual(["src/util/math.ts#add"])
    expect([...graph.calls.get("src/main.ts#<module>")!]).toEqual(["src/main.ts#main"])
  })

  test("records file imports including require", () => {
    expect([...graph.imports.get("src/main.ts")!].sort()).toEqual(["src/user.ts", "src/util/math.ts"])
    expect([...graph.imports.get("src/legacy.js")!]).toEqual(["src/util/math.ts"])
  })
})

describe("queries", () => {
  test("find_symbol ranks exact matches first", () => {
    expect(findSymbols(graph, "add").map((s) => s.id)[0]).toBe("src/util/math.ts#add")
    expect(findSymbols(graph, "service").map((s) => s.id)).toContain("src/user.ts#UserService.save")
    expect(findSymbols(graph, "s", 2)).toHaveLength(2)
  })

  test("resolves ids, names and Class.method; explains unknown and ambiguous names", () => {
    expect(resolveSymbol(graph, "src/util/math.ts#add").id).toBe("src/util/math.ts#add")
    expect(resolveSymbol(graph, "UserService.save").id).toBe("src/user.ts#UserService.save")
    expect(() => resolveSymbol(graph, "nope")).toThrow(QueryError)
    const g2 = CodeGraph.build(FIXTURE)
    g2.symbols.set("x.ts#add", { id: "x.ts#add", name: "add", kind: "function", file: "x.ts", line: 1 })
    expect(() => resolveSymbol(g2, "add")).toThrow(/ambiguous/)
  })

  test("callers and callees with depth", () => {
    const add = resolveSymbol(graph, "add")
    expect(ids(walkCalls(graph, add, "callers", 1)).sort()).toEqual(["src/legacy.js#sum", "src/main.ts#main", "src/util/math.ts#double"])
    expect(ids(walkCalls(graph, add, "callers", 3))).toContain("src/user.ts#UserService.save")
    const main = resolveSymbol(graph, "main")
    expect(walkCalls(graph, main, "callees", 2).find((r) => r.symbol.id === "src/user.ts#UserService.score")).toMatchObject({ depth: 2, via: "src/user.ts#UserService.save" })
  })

  test("shortest call path", () => {
    const chain = callPath(graph, resolveSymbol(graph, "main"), resolveSymbol(graph, "double"))!
    expect(chain.map((s) => s.id)).toEqual(["src/main.ts#main", "src/user.ts#UserService.save", "src/user.ts#UserService.score", "src/util/math.ts#double"])
    expect(callPath(graph, resolveSymbol(graph, "add"), resolveSymbol(graph, "main"))).toBeUndefined()
    expect(callPath(graph, resolveSymbol(graph, "main"), resolveSymbol(graph, "double"), 2)).toBeUndefined()
  })

  test("file dependencies and dependents", () => {
    expect(fileDependencies(graph, resolveFile(graph, "./src/main.ts"), "dependencies")).toEqual([{ file: "src/user.ts", depth: 1 }, { file: "src/util/math.ts", depth: 1 }])
    expect(fileDependencies(graph, "src/util/math.ts", "dependents", 2).map((d) => d.file)).toEqual(["src/legacy.js", "src/main.ts", "src/user.ts"])
    expect(resolveFile(graph, path.join(graph.root, "src/user.ts"))).toBe("src/user.ts")
    expect(() => resolveFile(graph, "nope.ts")).toThrow(/Unknown file/)
  })
})

describe("freshness", () => {
  let copy: string
  beforeAll(() => {
    copy = mkdtempSync(path.join(tmpdir(), "bobi-graph-"))
    cpSync(FIXTURE, copy, { recursive: true })
  })
  afterAll(() => rmSync(copy, { recursive: true, force: true }))

  test("detects changed, added and removed files", () => {
    const g = CodeGraph.build(copy)
    expect(g.stale()).toBe(false)
    utimesSync(path.join(copy, "src", "main.ts"), new Date(), new Date(Date.now() + 10_000))
    expect(g.stale()).toBe(true)
    const g2 = CodeGraph.build(copy)
    writeFileSync(path.join(copy, "src", "extra.ts"), "export const x = 1")
    expect(g2.stale()).toBe(true)
  })

  test("honours .gitignore", () => {
    writeFileSync(path.join(copy, ".gitignore"), "src/legacy.js\nsrc/util/\n")
    expect(listSourceFiles(copy).map((f) => path.relative(copy, f))).toEqual(["src/extra.ts", "src/main.ts", "src/user.ts"])
  })
})

test("dependency diagram: files by directory, or directories for large projects", async () => {
  const { dependencyDiagram } = await import("../src/index.ts")
  const graph = CodeGraph.build(path.join(import.meta.dir, "fixture"))
  const files = dependencyDiagram(graph)
  expect(files.startsWith("flowchart LR")).toBe(true)
  expect(files).toContain('subgraph n_dir_src_util["src/util"]')
  expect(files).toContain("n_src_main_ts --> n_src_util_math_ts")
  const dirs = dependencyDiagram(graph, { maxNodes: 1, depth: 1 })
  expect(dirs).toContain('n_src["src/"]')
  expect(dirs).not.toContain("subgraph")
})
