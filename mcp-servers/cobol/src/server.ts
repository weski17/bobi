// MCP server for COBOL analysis (requirement 16): structure, call graphs, data flow and impact analysis over a
// project's programs, copybooks and JCL. Tools appear in Bobi as `cobol_<tool>`. Read-only.
import { Server, type Tool } from "@modelcontextprotocol/server"
import { paragraphDiagram, systemDiagram } from "./diagram.ts"
import { CobolProject } from "./project.ts"
import { dataFlow, fieldInfo, find, getItem, getProgram, impact, listPrograms, outline, performs, programCalls, QueryError } from "./queries.ts"

export const SERVER_NAME = "cobol"
export const VERSION = "0.1.0"

const program = { type: "string", description: "PROGRAM-ID (e.g. CBACT01C) or source file path" }
const field = { type: "string", description: 'Data item name, optionally qualified: "ACCT-ID" or "ACCT-ID OF ACCOUNT-RECORD"' }
const depth = (max: number, def: number) => ({ type: "integer", minimum: 1, maximum: max, default: def, description: `How many levels to follow (1-${max})` })
const direction = (a: string, b: string) => ({ type: "string", enum: [a, b], default: a })

export const TOOLS: Tool[] = [
  {
    name: "list_programs",
    description: "COBOL programs in the project with kind (batch/online), copybooks, called programs and JCL jobs.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Filter by program id or path" } } },
  },
  {
    name: "find",
    description: "Search programs, copybooks, paragraphs/sections and data items by name.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 200, default: 30 } }, required: ["query"] },
  },
  {
    name: "program_outline",
    description: "Structure of one program: files (SELECT/FD), copybooks, records, paragraphs with PERFORMs, program calls, EXEC blocks, jobs.",
    inputSchema: { type: "object", properties: { program }, required: ["program"] },
  },
  {
    name: "performs",
    description: "PERFORM / GO TO graph inside a program, from a paragraph down (callees) or up (callers). Default start: the program entry.",
    inputSchema: { type: "object", properties: { program, paragraph: { type: "string" }, direction: direction("callees", "callers"), depth: depth(10, 2) }, required: ["program"] },
  },
  {
    name: "program_calls",
    description: "Calls between programs (CALL, LINK, XCTL) down (callees) or up (callers, including JCL steps that run the program).",
    inputSchema: { type: "object", properties: { program, direction: direction("callees", "callers"), depth: depth(6, 1) }, required: ["program"] },
  },
  {
    name: "field",
    description: "One data item: definition (PIC, USAGE, OCCURS, REDEFINES, copybook), groups, children, where it is read/written, direct data flow.",
    inputSchema: { type: "object", properties: { program, field }, required: ["program", "field"] },
  },
  {
    name: "data_flow",
    description: "Transitive data flow of a field through MOVE, COMPUTE, arithmetic, STRING, READ INTO, WRITE FROM: where its value goes (downstream) or comes from (upstream).",
    inputSchema: { type: "object", properties: { program, field, direction: direction("downstream", "upstream"), depth: depth(8, 3) }, required: ["program", "field"] },
  },
  {
    name: "impact",
    description:
      "Impact analysis: what is affected when a copybook, a program, a field (with program) or a dataset (DSN, * wildcard) changes – programs, paragraphs, downstream fields, callers and JCL jobs.",
    inputSchema: { type: "object", properties: { copybook: { type: "string" }, program, field, dataset: { type: "string" } } },
  },
  {
    name: "diagram",
    description: "Mermaid diagram: the program call graph with jobs (no program given) or one program's PERFORM graph.",
    inputSchema: { type: "object", properties: { program: { ...program, description: "Omit for the whole system" } } },
  },
] satisfies Tool[]

type Args = Record<string, unknown>
const str = (args: Args, key: string) => {
  const v = args[key]
  if (typeof v !== "string" || v === "") throw new QueryError(`"${key}" is required`)
  return v
}
const opt = (args: Args, key: string) => {
  const v = args[key]
  if (v === undefined) return undefined
  if (typeof v !== "string" || v === "") throw new QueryError(`"${key}" must be a non-empty string`)
  return v
}
const int = (args: Args, key: string, def: number, max: number) => {
  const v = args[key]
  if (v === undefined) return def
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > max) throw new QueryError(`"${key}" must be an integer between 1 and ${max}`)
  return v
}
const choice = <T extends string>(args: Args, key: string, values: readonly T[]): T => {
  const v = args[key] ?? values[0]
  if (!values.includes(v as T)) throw new QueryError(`"${key}" must be one of ${values.join(", ")}`)
  return v as T
}

/** Runs one tool against the (re)built index; returns JSON-serialisable data or text. */
export function runTool(project: CobolProject, name: string, args: Args): unknown {
  switch (name) {
    case "list_programs":
      return { programs: listPrograms(project, opt(args, "query")), ...(project.problems.length ? { problems: project.problems } : {}) }
    case "find":
      return find(project, str(args, "query"), int(args, "limit", 30, 200))
    case "program_outline":
      return outline(project, getProgram(project, str(args, "program")))
    case "performs":
      return performs(getProgram(project, str(args, "program")), opt(args, "paragraph"), choice(args, "direction", ["callees", "callers"]), int(args, "depth", 2, 10))
    case "program_calls":
      return programCalls(project, getProgram(project, str(args, "program")), choice(args, "direction", ["callees", "callers"]), int(args, "depth", 1, 6))
    case "field": {
      const p = getProgram(project, str(args, "program"))
      return fieldInfo(p, getItem(p, str(args, "field")))
    }
    case "data_flow": {
      const p = getProgram(project, str(args, "program"))
      return dataFlow(p, getItem(p, str(args, "field")), choice(args, "direction", ["downstream", "upstream"]), int(args, "depth", 3, 8))
    }
    case "impact":
      return impact(project, { copybook: opt(args, "copybook"), program: opt(args, "program"), field: opt(args, "field"), dataset: opt(args, "dataset") })
    case "diagram": {
      const p = opt(args, "program")
      return { mermaid: p ? paragraphDiagram(getProgram(project, p)) : systemDiagram(project) }
    }
    default:
      throw new QueryError(`Unknown tool "${name}"`)
  }
}

export function createServer(root: string): Server {
  let project: CobolProject | undefined
  const current = () => {
    if (!project || project.stale()) project = CobolProject.build(root)
    return project
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
