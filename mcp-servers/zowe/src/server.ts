// MCP server for mainframe access through the Zowe-compatible REST services (requirement 16). Tools appear in Bobi
// as `zowe_<tool>`. Every dataset and USS path is checked against an allowlist (default: the user's own datasets
// and home directory); writing and job submission are additionally confirmed by the user in Bobi (always ask).
import { Server, type Tool } from "@modelcontextprotocol/server"
import { MainframeClient, RestError, type RestOptions } from "./client.ts"
import { allowedDataset, checkMember, ConnectionError, loadConnection, requireDataset, requireUssPath, type Connection } from "./connection.ts"

export const SERVER_NAME = "zowe"
export const VERSION = "0.1.0"
/** Tools that change the mainframe; Bobi always asks before they run. */
export const WRITE_TOOLS = ["write_dataset", "submit_job"] as const

const dataset = { type: "string", description: "Fully qualified dataset name, e.g. USER1.COBOL.SRC" }
const member = { type: "string", description: "Member of a partitioned dataset (PDS), e.g. PAYCALC" }
const job = { jobname: { type: "string" }, jobid: { type: "string", description: "e.g. JOB01234" } }

export const TOOLS: Tool[] = [
  {
    name: "list_datasets",
    description: "List datasets matching a pattern (e.g. USER1.COBOL.*). Only allowed datasets are shown.",
    inputSchema: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
  },
  {
    name: "list_members",
    description: "List the members of a partitioned dataset.",
    inputSchema: { type: "object", properties: { dataset, pattern: { type: "string", description: "Member filter, e.g. PAY*" } }, required: ["dataset"] },
  },
  {
    name: "read_dataset",
    description: "Read a sequential dataset or a PDS member as text (e.g. COBOL source, copybook, JCL).",
    inputSchema: { type: "object", properties: { dataset, member }, required: ["dataset"] },
  },
  {
    name: "write_dataset",
    description: "Replace the content of a sequential dataset or PDS member with text. Changes the mainframe; always confirmed by the user.",
    inputSchema: { type: "object", properties: { dataset, member, content: { type: "string" } }, required: ["dataset", "content"] },
  },
  {
    name: "list_uss",
    description: "List a directory in the mainframe's UNIX file system.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "read_uss_file",
    description: "Read a text file from the mainframe's UNIX file system.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "list_jobs",
    description: "List batch jobs (default: the user's own jobs).",
    inputSchema: { type: "object", properties: { owner: { type: "string" }, prefix: { type: "string" }, status: { type: "string", enum: ["ACTIVE", "OUTPUT", "INPUT"] } } },
  },
  {
    name: "job_status",
    description: "Status and return code of one job.",
    inputSchema: { type: "object", properties: job, required: ["jobname", "jobid"] },
  },
  {
    name: "job_output",
    description: "Spool output of a job: the list of DD files, or the content of one (by ddname or id).",
    inputSchema: { type: "object", properties: { ...job, ddname: { type: "string" }, stepname: { type: "string" }, id: { type: "integer" } }, required: ["jobname", "jobid"] },
  },
  {
    name: "submit_job",
    description:
      "Submit JCL (inline text, or a dataset/member that holds it). All DSN= references must be allowed datasets. Jobs that call procedures, use INCLUDE/JCLLIB, the internal reader, PATH= or utilities with instream commands (IDCAMS, IKJEFT01, BPXBATCH, …) are refused because their datasets cannot be checked. Runs on the mainframe; always confirmed by the user.",
    inputSchema: { type: "object", properties: { jcl: { type: "string" }, dataset, member } },
  },
] satisfies Tool[]

type Args = Record<string, unknown>
const str = (args: Args, key: string) => {
  const v = args[key]
  if (typeof v !== "string" || v === "") throw new ConnectionError(`"${key}" is required`)
  return v
}
const opt = (args: Args, key: string) => {
  const v = args[key]
  if (v === undefined) return undefined
  if (typeof v !== "string" || v === "") throw new ConnectionError(`"${key}" must be a non-empty string`)
  return v
}
const JOB_NAME = /^[A-Z#$@][A-Z0-9#$@]{0,7}$/
const JOB_ID = /^[A-Z0-9]{1,8}$/
const jobArgs = (args: Args) => {
  const jobname = str(args, "jobname").toUpperCase()
  const jobid = str(args, "jobid").toUpperCase()
  if (!JOB_NAME.test(jobname) || !JOB_ID.test(jobid)) throw new ConnectionError("jobname and jobid must be valid job identifiers")
  return { jobname, jobid }
}

/** Dataset names referenced by DSN= in JCL (temporary && datasets and backward references are skipped). */
export function jclDatasets(jcl: string): string[] {
  const out = new Set<string>()
  for (const line of jcl.split(/\r?\n/)) {
    if (!line.startsWith("//") || line.startsWith("//*")) continue
    for (const m of line.slice(0, 72).matchAll(/DSN(?:AME)?=('[^']*'|[^,\s(]+(?:\([^)]*\))?)/gi)) {
      const name = m[1]!.replace(/^'|'$/g, "").replace(/\(.*\)$/, "").toUpperCase()
      if (name.startsWith("&&") || name.startsWith("*.")) continue
      out.add(name)
    }
  }
  return [...out]
}

/** Programs whose instream commands (SYSIN, SYSTSIN, STDPARM …) name datasets or run commands the DSN check cannot see. */
const COMMAND_PROGRAMS = new Set(["IDCAMS", "IKJEFT01", "IKJEFT1A", "IKJEFT1B", "BPXBATCH", "BPXBATSL", "BPXBATA2", "BPXBATA8", "ADRDSSU", "IRXJCL", "IEBUPDTE"])

/**
 * Reasons why Bobi cannot check what a job touches. The DSN= check only sees DD statements in the submitted text; a job
 * that calls a procedure, pulls in other JCL, writes to the internal reader, uses USS paths or runs a utility with
 * instream commands could reach any dataset. Such jobs are refused (security review 2026-11-19, H5). The real limit
 * is the mainframe user's own rights (RACF); this check is a second line, not a guarantee.
 */
export function jclProblems(jcl: string): string[] {
  const problems = new Set<string>()
  for (const raw of jcl.split(/\r?\n/)) {
    if (!raw.startsWith("//") || raw.startsWith("//*")) continue
    const line = raw.slice(0, 72).toUpperCase()
    const m = /^\/\/(\S*)\s+(\S+)(?:\s+(.*))?$/.exec(line)
    if (!m) continue
    const [, , op, operands = ""] = m
    if (op === "JCLLIB") problems.add("JCLLIB (procedures from other libraries are not checked)")
    if (op === "INCLUDE") problems.add("INCLUDE (included JCL is not checked)")
    if (op === "EXEC") {
      const pgm = /(?:^|,)PGM=([A-Z0-9#$@]+)/.exec(operands)
      if (!pgm) problems.add("EXEC of a procedure (its DD statements are not checked)")
      else if (COMMAND_PROGRAMS.has(pgm[1]!)) problems.add(`EXEC PGM=${pgm[1]} (its instream commands are not checked)`)
    }
    if (/INTRDR/.test(operands)) problems.add("internal reader (INTRDR would submit JCL that is not checked)")
    if (/(?:^|,)PATH=/.test(operands)) problems.add("PATH= (USS files in JCL are not checked)")
  }
  return [...problems]
}

/** Refuses JCL whose datasets cannot be checked, then checks every DSN= against the allowlist. */
function checkJcl(c: Connection, jcl: string) {
  const problems = jclProblems(jcl)
  if (problems.length) throw new ConnectionError(`Bobi does not submit this job because it cannot check what it touches: ${problems.join("; ")}. Submit it yourself if it is intended.`)
  for (const referenced of jclDatasets(jcl)) requireDataset(c, referenced)
}

export async function runTool(client: MainframeClient, name: string, args: Args): Promise<unknown> {
  const c: Connection = client.connection
  const memberOf = (a: Args) => (opt(a, "member") ? checkMember(opt(a, "member")!) : undefined)
  switch (name) {
    case "list_datasets": {
      const items = await client.listDatasets(str(args, "pattern").toUpperCase())
      const allowed = items.filter((d) => allowedDataset(c, d.dsname))
      return { datasets: allowed, ...(allowed.length < items.length ? { hidden: items.length - allowed.length, allowedPatterns: c.datasets } : {}) }
    }
    case "list_members":
      return { dataset: requireDataset(c, str(args, "dataset")), members: await client.listMembers(requireDataset(c, str(args, "dataset")), opt(args, "pattern")?.toUpperCase()) }
    case "read_dataset": {
      const ds = requireDataset(c, str(args, "dataset"))
      const m = memberOf(args)
      const { text, truncated } = await client.readDataset(ds, m)
      return { dataset: ds, ...(m ? { member: m } : {}), ...(truncated ? { truncated: true } : {}), content: text }
    }
    case "write_dataset": {
      const ds = requireDataset(c, str(args, "dataset"))
      const m = memberOf(args)
      const content = args.content
      if (typeof content !== "string") throw new ConnectionError('"content" is required')
      await client.writeDataset(ds, m, content)
      return { written: m ? `${ds}(${m})` : ds, lines: content.split("\n").length }
    }
    case "list_uss": {
      const dir = requireUssPath(c, str(args, "path"))
      return { path: dir, entries: await client.listUss(dir) }
    }
    case "read_uss_file": {
      const file = requireUssPath(c, str(args, "path"))
      const { text, truncated } = await client.readUss(file)
      return { path: file, ...(truncated ? { truncated: true } : {}), content: text }
    }
    case "list_jobs":
      return { jobs: await client.listJobs({ owner: (opt(args, "owner") ?? c.user).toUpperCase(), prefix: opt(args, "prefix")?.toUpperCase(), status: opt(args, "status") }) }
    case "job_status": {
      const { jobname, jobid } = jobArgs(args)
      return await client.jobStatus(jobname, jobid)
    }
    case "job_output": {
      const { jobname, jobid } = jobArgs(args)
      const files = await client.spoolFiles(jobname, jobid)
      const ddname = opt(args, "ddname")?.toUpperCase()
      const stepname = opt(args, "stepname")?.toUpperCase()
      const id = args.id
      if (ddname === undefined && id === undefined) return { jobname, jobid, files }
      const file = files.find((f) => (id !== undefined ? f.id === id : f.ddname === ddname && (!stepname || f.stepname === stepname)))
      if (!file) throw new ConnectionError(`Job ${jobname}(${jobid}) has no spool file ${ddname ?? id}. Files: ${files.map((f) => `${f.stepname ?? ""}.${f.ddname}#${f.id}`).join(", ")}`)
      const { text, truncated } = await client.spoolContent(jobname, jobid, file.id)
      return { jobname, jobid, file, ...(truncated ? { truncated: true } : {}), content: text }
    }
    case "submit_job": {
      const jcl = opt(args, "jcl")
      const source = opt(args, "dataset")
      if ((jcl === undefined) === (source === undefined)) throw new ConnectionError('Give either "jcl" or "dataset" (with optional "member")')
      if (source !== undefined) {
        const ds = requireDataset(c, source)
        const m = memberOf(args)
        // The JCL in the dataset is checked like inline JCL before it is submitted.
        checkJcl(c, (await client.readDataset(ds, m)).text)
        return { submitted: await client.submitDataset(ds, m) }
      }
      checkJcl(c, jcl!)
      return { submitted: await client.submitJcl(jcl!) }
    }
    default:
      throw new ConnectionError(`Unknown tool "${name}"`)
  }
}

export function createServer(project: string, options: RestOptions & { env?: Record<string, string | undefined> } = {}): Server {
  const server = new Server({ name: SERVER_NAME, version: VERSION }, { capabilities: { tools: {} } })
  server.setRequestHandler("tools/list", async () => ({ tools: TOOLS }))
  server.setRequestHandler("tools/call", async (request) => {
    try {
      // The connection is read per call, so changed profiles or variables apply without a restart.
      const client = new MainframeClient(loadConnection(project, options.env ?? process.env), options)
      const data = await runTool(client, request.params.name, (request.params.arguments ?? {}) as Args)
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }
    } catch (error) {
      if (error instanceof ConnectionError || error instanceof RestError) return { content: [{ type: "text", text: error.message }], isError: true }
      if (error instanceof Error && (error.name === "TimeoutError" || /fetch|connect|ECONN|certificate/i.test(error.message)))
        return { content: [{ type: "text", text: `Mainframe not reachable: ${error.message}` }], isError: true }
      throw error
    }
  })
  return server
}
