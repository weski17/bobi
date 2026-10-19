export { CodeGraph, listSourceFiles } from "./graph.ts"
export type { CodeSymbol, SymbolKind } from "./graph.ts"
export { callPath, fileDependencies, findSymbols, QueryError, resolveFile, resolveSymbol, walkCalls } from "./queries.ts"
export { createServer, runTool, SERVER_NAME, TOOLS, VERSION } from "./server.ts"
import path from "node:path"
/** Command line that starts the server for a project (used by @bobi/core as a built-in MCP server). */
export const CLI = path.join(import.meta.dir, "cli.ts")
