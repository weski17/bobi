export { paragraphDiagram, systemDiagram } from "./diagram.ts"
export { parseProgram, resolveName } from "./program.ts"
export type { DataItem, Program } from "./program.ts"
export { CobolProject, parseJcl } from "./project.ts"
export type { JobStep } from "./project.ts"
export { dataFlow, fieldInfo, find, impact, listPrograms, outline, overlapping, performs, programCalls, QueryError } from "./queries.ts"
export { createServer, runTool, SERVER_NAME, TOOLS, VERSION } from "./server.ts"
export { applyReplacing, expand, normalize, tokenize } from "./source.ts"
import path from "node:path"
/** Command line that starts the server for a project (used by @bobi/server as a built-in MCP server). */
export const CLI = path.join(import.meta.dir, "cli.ts")
