// MCP server exposing the code graph (requirement 16). Tools appear in Bobi as `code-graph_<tool>`.
import { Server, type Tool } from "@modelcontextprotocol/server"
import { CodeGraph } from "./graph.ts"
import { callPath, fileDependencies, findSymbols, QueryError, resolveFile, resolveSymbol, walkCalls } from "./queries.ts"

export const SERVER_NAME = "code-graph"
export const VERSION = "0.1.0"

const symbol = { type: "string", description: 'Symbol id like "src/user.ts#UserService.save", or a unique name / Class.method' }
const depth = (max: number, def: number) => ({ type: "integer", minimum: 1, maximum: max, default: def, description: `How many levels to follow (1-${max})` })

export const TOOLS: Tool[] = [
  {
    name: "find_symbol",
    description: "Search functions, classes and methods by name. Returns ids to use with the other tools.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100, default: 20 } }, required: ["query"] },
  },
  {
    name: "callers",
    description: "Who calls this symbol (call chains upwards). Static analysis: dynamic calls are not visible.",
    inputSchema: { type: "object", properties: { symbol, depth: depth(5, 1) }, required: ["symbol"] },
  },
  {
    name: "callees",
    description: "What this symbol calls (call chains downwards).",
    inputSchema: { type: "object", properties: { symbol, depth: depth(5, 1) }, required: ["symbol"] },
  },
  {
    name: "call_path",
    description: "Shortest call chain from one symbol to another, if any.",
    inputSchema: { type: "object", properties: { from: symbol, to: symbol, maxDepth: depth(12, 8) }, required: ["from", "to"] },
  },
  {
    name: "dependencies",
    description: "Files that a file imports (directly or up to depth).",
    inputSchema: { type: "object", properties: { file: { type: "string", description: "Path relative to the project root" }, depth: depth(5, 1) }, required: ["file"] },
  },
  {
    name: "dependents",
    description: "Files that import a file (impact of changing it).",
    inputSchema: { type: "object", properties: { file: { type: "string", description: "Path relative to the project root" }, depth: depth(5, 1) }, required: ["file"] },
  },
] satisfies Tool[]

type Args = Record<string, unknown>
const str = (args: Args, key: string) => {
  const v = args[key]
  if (typeof v !== "string" || v === "") throw new QueryError(`"${key}" is required`)
  return v
}
const int = (args: Args, key: string, def: number, max: number) => {
  const v = args[key]
  if (v === undefined) return def
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > max) throw new QueryError(`"${key}" must be an integer between 1 and ${max}`)
  return v
}

/** Runs one tool against the (re)built graph; returns JSON-serialisable data. */
export function runTool(graph: CodeGraph, name: string, args: Args): unknown {
  switch (name) {
    case "find_symbol":
      return findSymbols(graph, str(args, "query"), int(args, "limit", 20, 100))
    case "callers":
    case "callees": {
      const start = resolveSymbol(graph, str(args, "symbol"))
      return { symbol: start, [name]: walkCalls(graph, start, name, int(args, "depth", 1, 5)).map((r) => ({ ...r.symbol, depth: r.depth, via: r.via })) }
    }
    case "call_path": {
      const from = resolveSymbol(graph, str(args, "from"))
      const to = resolveSymbol(graph, str(args, "to"))
      const path = callPath(graph, from, to, int(args, "maxDepth", 8, 12))
      return path ? { found: true, path } : { found: false, message: `No static call path from ${from.id} to ${to.id}.` }
    }
    case "dependencies":
    case "dependents": {
      const file = resolveFile(graph, str(args, "file"))
      return { file, [name]: fileDependencies(graph, file, name, int(args, "depth", 1, 5)) }
    }
    default:
      throw new QueryError(`Unknown tool "${name}"`)
  }
}

export function createServer(root: string): Server {
  let graph: CodeGraph | undefined
  const current = () => {
    if (!graph || graph.stale()) graph = CodeGraph.build(root)
    return graph
  }
  const server = new Server({ name: SERVER_NAME, version: VERSION }, { capabilities: { tools: {} } })
  server.setRequestHandler("tools/list", async () => ({ tools: TOOLS }))
  server.setRequestHandler("tools/call", async (request) => {
    try {
      const data = runTool(current(), request.params.name, (request.params.arguments ?? {}) as Args)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    } catch (error) {
      if (error instanceof QueryError) return { content: [{ type: "text", text: error.message }], isError: true }
      throw error
    }
  })
  return server
}
