import { afterAll, beforeAll, expect, test } from "bun:test"
import path from "node:path"
import { Client } from "@modelcontextprotocol/client"
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio"
import { CLI, CodeGraph, runTool, TOOLS } from "../src/index.ts"

const FIXTURE = path.join(import.meta.dir, "fixture")
let client: Client

beforeAll(async () => {
  client = new Client({ name: "test", version: "1.0.0" })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [CLI, FIXTURE] }))
}, 30_000)
afterAll(async () => {
  await client.close()
})

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content as { type: string; text: string }[])[0]!.text
  return { error: result.isError === true, text, data: result.isError ? undefined : JSON.parse(text) }
}

test("lists its tools over MCP stdio", async () => {
  const { tools } = await client.listTools()
  expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name))
})

test("answers graph questions", async () => {
  expect((await call("find_symbol", { query: "save" })).data[0].id).toBe("src/user.ts#UserService.save")
  expect((await call("callers", { symbol: "add" })).data.callers.map((c: { id: string }) => c.id)).toContain("src/legacy.js#sum")
  expect((await call("callees", { symbol: "main", depth: 2 })).data.callees.length).toBeGreaterThanOrEqual(4)
  expect((await call("call_path", { from: "main", to: "add" })).data).toMatchObject({ found: true })
  expect((await call("call_path", { from: "add", to: "main" })).data).toMatchObject({ found: false })
  expect((await call("dependencies", { file: "src/main.ts" })).data.dependencies).toHaveLength(2)
  expect((await call("dependents", { file: "src/util/math.ts", depth: 2 })).data.dependents).toHaveLength(3)
})

test("explains bad input as tool errors", async () => {
  expect(await call("callers", { symbol: "nope" })).toMatchObject({ error: true })
  expect((await call("callers", {})).text).toContain('"symbol" is required')
  expect((await call("callers", { symbol: "add", depth: 99 })).text).toContain("between 1 and 5")
  expect((await call("call_path", { from: "add", to: "main", maxDepth: "x" })).text).toContain("maxDepth")
  expect((await call("unknown_tool", {})).text).toContain("Unknown tool")
})

test("runTool defaults", () => {
  const graph = CodeGraph.build(FIXTURE)
  expect(runTool(graph, "callees", { symbol: "UserService.save" })).toMatchObject({ callees: [{ id: "src/user.ts#UserService.score", depth: 1 }] })
})

test("the server works in-process and rebuilds the graph when files change", async () => {
  const { InMemoryTransport } = await import("@modelcontextprotocol/client")
  const { createServer } = await import("../src/server.ts")
  const { cpSync, mkdtempSync, rmSync, writeFileSync } = await import("node:fs")
  const { tmpdir } = await import("node:os")
  const copy = mkdtempSync(path.join(tmpdir(), "bobi-graph-srv-"))
  cpSync(FIXTURE, copy, { recursive: true })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const server = createServer(copy)
  await server.connect(serverSide)
  const local = new Client({ name: "t", version: "1" })
  await local.connect(clientSide)
  try {
    const before = await local.callTool({ name: "find_symbol", arguments: { query: "freshlyAdded" } })
    expect(JSON.parse((before.content as { text: string }[])[0]!.text)).toEqual([])
    writeFileSync(path.join(copy, "src", "fresh.ts"), "export function freshlyAdded() {}")
    const after = await local.callTool({ name: "find_symbol", arguments: { query: "freshlyAdded" } })
    expect(JSON.parse((after.content as { text: string }[])[0]!.text)[0].id).toBe("src/fresh.ts#freshlyAdded")
    for (const [name, args] of [["callers", { symbol: "add", depth: 2 }], ["call_path", { from: "main", to: "double" }], ["dependents", { file: "src/user.ts" }], ["callers", { symbol: "nope" }]] as const)
      expect((await local.callTool({ name, arguments: args })).content).toBeDefined()
  } finally {
    await local.close()
    rmSync(copy, { recursive: true, force: true })
  }
})
