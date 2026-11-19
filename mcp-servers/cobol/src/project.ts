// Project index for COBOL: programs, copybooks and JCL jobs under a root, rebuilt when files change.
import { readFileSync, statSync } from "node:fs"
import path from "node:path"
import { listSourceFiles } from "@bobi/mcp-code-graph"
import { parseProgram, type Program } from "./program.ts"
import { expand } from "./source.ts"

export const PROGRAM_EXTENSIONS = new Set([".cbl", ".cob", ".cobol", ".ccp"])
export const COPYBOOK_EXTENSIONS = new Set([".cpy", ".copy", ".dcl", ".inc"])
export const JCL_EXTENSIONS = new Set([".jcl", ".prc", ".proc"])
const MAX_FILE_BYTES = 2_000_000

const ext = (name: string) => path.extname(name).toLowerCase()
const isCobolFile = (name: string) => PROGRAM_EXTENSIONS.has(ext(name)) || COPYBOOK_EXTENSIONS.has(ext(name)) || JCL_EXTENSIONS.has(ext(name))
const member = (file: string) => path.basename(file, path.extname(file)).toUpperCase()

export type JobStep = {
  readonly job: string
  readonly step: string
  readonly file: string
  readonly line: number
  readonly program?: string
  readonly proc?: string
  /** DD name → dataset name (or SYSOUT/DUMMY/instream). */
  readonly dd: Record<string, string>
}

export class CobolProject {
  readonly programs = new Map<string, Program>()
  readonly copybooks = new Map<string, string[]>()
  readonly steps: JobStep[] = []
  readonly problems: { file: string; message: string }[] = []
  private stamps = new Map<string, number>()

  private constructor(readonly root: string) {}

  static build(root: string): CobolProject {
    const project = new CobolProject(path.resolve(root))
    project.index(listSourceFiles(project.root, isCobolFile))
    return project
  }

  stale(): boolean {
    const files = listSourceFiles(this.root, isCobolFile)
    if (files.length !== this.stamps.size) return true
    return files.some((f) => this.stamps.get(f) !== statSync(f, { throwIfNoEntry: false })?.mtimeMs)
  }

  rel(file: string): string {
    return path.relative(this.root, file).replaceAll("\\", "/")
  }

  /** Copybook file for a member name; with several candidates, the one closest to the including file. */
  resolveCopybook(name: string, from: string): string | undefined {
    const candidates = this.copybooks.get(name.toUpperCase())
    if (!candidates?.length) return undefined
    const distance = (file: string) => {
      const a = path.dirname(from).split(path.sep)
      const b = path.dirname(file).split(path.sep)
      let common = 0
      while (common < a.length && a[common] === b[common]) common++
      return a.length + b.length - 2 * common
    }
    return [...candidates].sort((x, y) => distance(x) - distance(y) || x.localeCompare(y))[0]
  }

  private index(files: string[]) {
    for (const f of files) this.stamps.set(f, statSync(f).mtimeMs)
    for (const f of files) if (COPYBOOK_EXTENSIONS.has(ext(f))) this.copybooks.set(member(f), [...(this.copybooks.get(member(f)) ?? []), f])
    for (const f of files) {
      if (statSync(f).size > MAX_FILE_BYTES) {
        this.problems.push({ file: this.rel(f), message: "skipped: file larger than 2 MB" })
        continue
      }
      if (JCL_EXTENSIONS.has(ext(f))) this.steps.push(...parseJcl(readFileSync(f, "utf8"), this.rel(f)))
      if (!PROGRAM_EXTENSIONS.has(ext(f))) continue
      try {
        const { tokens, copies } = expand(readFileSync(f, "utf8"), f, { resolve: (n, from) => this.resolveCopybook(n, from), read: (file) => readLimited(file) })
        const relTokens = tokens.map((t) => ({ ...t, file: this.rel(t.file) }))
        const relCopies = copies.map((c) => ({ ...c, file: this.rel(c.file), ...(c.resolved ? { resolved: this.rel(c.resolved) } : {}) }))
        const program = parseProgram(relTokens, this.rel(f), relCopies)
        if (this.programs.has(program.id)) this.problems.push({ file: this.rel(f), message: `duplicate PROGRAM-ID ${program.id}; first one kept` })
        else this.programs.set(program.id, program)
      } catch (error) {
        this.problems.push({ file: this.rel(f), message: `parse error: ${(error as Error).message}` })
      }
    }
  }
}

/** A copybook, with the same size limit as programs. */
function readLimited(file: string): string {
  if (statSync(file).size > MAX_FILE_BYTES) throw new Error(`${file} is larger than 2 MB`)
  return readFileSync(file, "utf8")
}

/** JCL: //name JOB, //step EXEC PGM=x | PROC=x | x, //dd DD DSN=x (with continuation lines). */
export function parseJcl(source: string, file: string): JobStep[] {
  const steps: JobStep[] = []
  let job = member(file)
  let step: { job: string; step: string; file: string; line: number; program?: string; proc?: string; dd: Record<string, string> } | undefined
  let dd: string | undefined
  const lines = source.replace(/\r\n?/g, "\n").split("\n")
  lines.forEach((raw, index) => {
    const text = raw.slice(0, 72)
    if (!text.startsWith("//") || text.startsWith("//*")) return
    const m = /^\/\/(\S*)\s+(\S+)\s*(.*)$/.exec(text)
    if (!m) return
    const [, name, op, rest] = m as unknown as [string, string, string, string]
    const operands = rest.split(/\s+/)[0] ?? ""
    if (op === "JOB") job = name || job
    else if (op === "EXEC") {
      if (step) steps.push(step)
      const pgm = /(?:^|,)PGM=([^,\s]+)/i.exec(operands)
      const proc = /(?:^|,)PROC=([^,\s]+)/i.exec(operands)
      const bare = !pgm && !proc ? /^([A-Z0-9$#@]+)(,|$)/i.exec(operands) : null
      step = {
        job,
        step: name || `STEP${steps.length + 1}`,
        file,
        line: index + 1,
        ...(pgm ? { program: pgm[1]!.toUpperCase() } : {}),
        ...(proc || bare ? { proc: (proc ?? bare)![1]!.toUpperCase() } : {}),
        dd: {},
      }
      dd = undefined
    } else if (op === "DD" && step) {
      dd = name || dd
      if (dd) step.dd[dd.toUpperCase()] = describeDd(operands)
    } else if (!name && step && dd && /DSN(AME)?=/i.test(op)) {
      // continuation: "//         DSN=..." (the operand ends up in `op`)
      step.dd[dd.toUpperCase()] = describeDd(op)
    }
  })
  if (step) steps.push(step)
  return steps
}

function describeDd(operands: string): string {
  const dsn = /(?:^|,)DSN(?:AME)?=([^,\s]+)/i.exec(operands)
  if (dsn) return dsn[1]!.toUpperCase()
  if (/SYSOUT=/i.test(operands)) return "SYSOUT"
  if (/DUMMY/i.test(operands)) return "DUMMY"
  if (operands.startsWith("*") || /DATA/i.test(operands)) return "INSTREAM"
  return operands.toUpperCase()
}
