// Queries over the COBOL project index: outlines, PERFORM and program call graphs, data flow and impact analysis.
import type { DataItem, Program } from "./program.ts"
import { resolveName } from "./program.ts"
import type { CobolProject, JobStep } from "./project.ts"

export class QueryError extends Error {}

/** Copybooks supplied by the runtime environment (not part of a project). */
export const SYSTEM_COPYBOOK = /^(DFH|CMQ|SQLCA$|SQLDA$)/

export function getProgram(project: CobolProject, name: string): Program {
  const program = project.programs.get(name.toUpperCase())
  if (program) return program
  const byFile = [...project.programs.values()].find((p) => p.file === name || p.file.toUpperCase().endsWith(`/${name.toUpperCase()}`))
  if (byFile) return byFile
  const similar = [...project.programs.keys()].filter((id) => id.includes(name.toUpperCase().slice(0, 4))).slice(0, 5)
  throw new QueryError(`Unknown program "${name}".${similar.length ? ` Similar: ${similar.join(", ")}` : ""} Use find or list_programs.`)
}

export function getItem(program: Program, name: string): DataItem {
  const [field, ...qualifiers] = name.toUpperCase().split(/\s+(?:OF|IN)\s+/)
  const id = program.items.has(field!) && qualifiers.length === 0 ? field! : resolveName(program, field!, qualifiers)
  const item = id ? program.items.get(id) : undefined
  if (!item) throw new QueryError(`Program ${program.id} has no data item "${name}". Use find with the field name.`)
  return item
}

const describeItem = (item: DataItem) => ({
  id: item.id,
  level: item.level,
  ...(item.picture ? { picture: item.picture } : {}),
  ...(item.usage ? { usage: item.usage } : {}),
  ...(item.occurs ? { occurs: item.occurs } : {}),
  ...(item.redefines ? { redefines: item.redefines } : {}),
  ...(item.value ? { value: item.value } : {}),
  file: item.file,
  line: item.line,
})

export function listPrograms(project: CobolProject, query?: string) {
  const q = query?.toUpperCase()
  return [...project.programs.values()]
    .filter((p) => !q || p.id.includes(q) || p.file.toUpperCase().includes(q))
    .map((p) => ({
      program: p.id,
      file: p.file,
      kind: p.execs.some((e) => e.kind === "online") ? "online" : "batch",
      paragraphs: p.paragraphs.length,
      calls: [...new Set(p.calls.map((c) => c.target ?? `(dynamic ${c.via})`))],
      copybooks: [...new Set(p.copies.map((c) => c.name))],
      jobs: project.steps.filter((s) => s.program === p.id).map((s) => `${s.job}.${s.step}`),
    }))
}

export function outline(project: CobolProject, program: Program) {
  const top = [...program.items.values()].filter((i) => (i.level === 1 || i.level === 77) && !i.parent)
  return {
    program: program.id,
    file: program.file,
    using: program.using,
    files: program.files.map((f) => ({ ...f, records: top.filter((i) => i.fileName === f.name).map((i) => i.name) })),
    copybooks: program.copies.map((c) => ({ name: c.name, at: `${c.file}:${c.line}`, ...(c.resolved ? { file: c.resolved } : { unresolved: true, system: SYSTEM_COPYBOOK.test(c.name) }) })),
    records: top.map((i) => ({ name: i.name, section: i.section, children: i.children.length, file: i.file, line: i.line })),
    paragraphs: program.paragraphs.map((p) => ({
      name: p.name,
      kind: p.kind,
      line: p.line,
      performs: [...new Set(program.edges.filter((e) => e.from === p.name).map((e) => e.to))],
    })),
    calls: program.calls.map((c) => ({ kind: c.kind, target: c.target ?? null, ...(c.via ? { via: c.via } : {}), paragraph: c.paragraph, line: c.line, using: c.using })),
    exec: program.execs.map((e) => ({ kind: e.kind, command: e.command, paragraph: e.paragraph, line: e.line, resources: e.resources })),
    jobs: project.steps.filter((s) => s.program === program.id).map((s) => ({ job: s.job, step: s.step, file: s.file, dd: s.dd })),
  }
}

export function performs(program: Program, start: string | undefined, direction: "callees" | "callers", depth: number) {
  const names = new Set(["(main)", ...program.paragraphs.map((p) => p.name)])
  const root = start ? start.toUpperCase() : "(main)"
  if (!names.has(root)) throw new QueryError(`Program ${program.id} has no paragraph "${start}". Paragraphs: ${program.paragraphs.map((p) => p.name).slice(0, 30).join(", ")}`)
  const out: { paragraph: string; depth: number; via: string; kind: string; line: number }[] = []
  const seen = new Set([root])
  let frontier = [root]
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = []
    for (const name of frontier)
      for (const e of program.edges) {
        const [from, to] = direction === "callees" ? [e.from, e.to] : [e.to, e.from]
        if (from !== name || seen.has(to)) continue
        seen.add(to)
        next.push(to)
        out.push({ paragraph: to, depth: d, via: name, kind: e.kind + (e.thru ? ` THRU ${e.thru}` : ""), line: e.line })
      }
    frontier = next
  }
  return { program: program.id, paragraph: root, [direction]: out }
}

type CallStep = { program: string; depth: number; via: string; kind: string; paragraph: string; line: number; inProject: boolean }
type CallsResult = {
  program: string
  callees?: CallStep[]
  callers?: CallStep[]
  unresolvedDynamicCalls?: { via?: string; paragraph: string; line: number }[]
  jobs?: string[]
}

export function programCalls(project: CobolProject, program: Program, direction: "callees" | "callers", depth: number): CallsResult {
  const out: CallStep[] = []
  const seen = new Set([program.id])
  let frontier = [program.id]
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = []
    for (const name of frontier) {
      const edges =
        direction === "callees"
          ? (project.programs.get(name)?.calls ?? []).filter((c) => c.target).map((c) => ({ other: c.target!, c }))
          : [...project.programs.values()].flatMap((p) => p.calls.filter((c) => c.target === name).map((c) => ({ other: p.id, c })))
      for (const { other, c } of edges) {
        if (seen.has(other)) continue
        seen.add(other)
        next.push(other)
        out.push({ program: other, depth: d, via: name, kind: c.kind, paragraph: c.paragraph, line: c.line, inProject: project.programs.has(other) })
      }
    }
    frontier = next
  }
  const dynamic = direction === "callees" ? program.calls.filter((c) => !c.target).map((c) => ({ via: c.via, paragraph: c.paragraph, line: c.line })) : []
  const jobs = direction === "callers" ? project.steps.filter((s) => s.program === program.id).map((s) => `${s.job}.${s.step} (${s.file})`) : []
  return { program: program.id, [direction]: out, ...(dynamic.length ? { unresolvedDynamicCalls: dynamic } : {}), ...(jobs.length ? { jobs } : {}) }
}

/** The item, its groups and subordinates, and REDEFINES aliases: storage that changes together. */
export function overlapping(program: Program, id: string): Set<string> {
  const out = new Set<string>([id])
  let parent = program.items.get(id)?.parent
  while (parent) {
    out.add(parent)
    parent = program.items.get(parent)?.parent
  }
  const descend = (item: string) => {
    for (const child of program.items.get(item)?.children ?? []) {
      if (program.items.get(child)?.level === 88) continue
      out.add(child)
      descend(child)
    }
  }
  descend(id)
  for (const item of program.items.values()) {
    if (item.redefines && (out.has(item.redefines) || out.has(item.id))) {
      out.add(item.id)
      out.add(item.redefines)
    }
  }
  return out
}

export function fieldInfo(program: Program, item: DataItem) {
  const chain: string[] = []
  let parent = item.parent
  while (parent) {
    chain.push(parent)
    parent = program.items.get(parent)?.parent
  }
  const related = item.level === 88 ? new Set([item.id]) : new Set([item.id, ...item.children.filter((c) => program.items.get(c)?.level === 88)])
  const accesses = program.accesses.filter((a) => related.has(a.item))
  const byParagraph = new Map<string, { reads: number[]; writes: number[] }>()
  for (const a of accesses) {
    const entry = byParagraph.get(a.paragraph) ?? { reads: [], writes: [] }
    ;(a.mode === "read" ? entry.reads : entry.writes).push(a.line)
    byParagraph.set(a.paragraph, entry)
  }
  return {
    program: program.id,
    field: { name: item.name, ...describeItem(item), section: item.section, ...(item.fileName ? { recordOf: item.fileName } : {}) },
    groups: chain,
    children: item.children.slice(0, 100).map((c) => describeItem(program.items.get(c)!)),
    redefinedBy: [...program.items.values()].filter((i) => i.redefines === item.id).map((i) => i.id),
    usedIn: [...byParagraph].map(([paragraph, v]) => ({ paragraph, reads: v.reads, writes: v.writes })),
    from: program.flows.filter((f) => f.to === item.id).map((f) => ({ field: f.from, verb: f.verb, paragraph: f.paragraph, line: f.line })),
    to: program.flows.filter((f) => f.from === item.id).map((f) => ({ field: f.to, verb: f.verb, paragraph: f.paragraph, line: f.line })),
    passedTo: program.calls.filter((c) => c.using.some((u) => overlapping(program, item.id).has(u))).map((c) => ({ kind: c.kind, target: c.target ?? null, paragraph: c.paragraph, line: c.line })),
  }
}

export function dataFlow(program: Program, item: DataItem, direction: "downstream" | "upstream", depth: number) {
  const steps: { field: string; depth: number; via: string; verb: string; paragraph: string; line: number }[] = []
  const seen = new Set([item.id])
  let frontier = [item.id]
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = []
    for (const id of frontier) {
      const storage = overlapping(program, id)
      for (const f of program.flows) {
        const [from, to] = direction === "downstream" ? [f.from, f.to] : [f.to, f.from]
        if (!storage.has(from) || seen.has(to)) continue
        seen.add(to)
        next.push(to)
        steps.push({ field: to, depth: d, via: from, verb: f.verb, paragraph: f.paragraph, line: f.line })
      }
    }
    frontier = next
  }
  return { program: program.id, field: item.id, direction, note: "Includes moves of enclosing groups and REDEFINES aliases.", [direction]: steps }
}

const jobsOf = (project: CobolProject, programs: Iterable<string>) => {
  const set = new Set(programs)
  return project.steps.filter((s) => s.program && set.has(s.program)).map((s) => `${s.job}.${s.step} (${s.file})`)
}

const callersOf = (project: CobolProject, id: string, depth: number) =>
  (programCalls(project, getProgram(project, id), "callers", depth).callers ?? []).map((c) => c.program)

export type ImpactTarget = { copybook?: string; program?: string; field?: string; dataset?: string }

export function impact(project: CobolProject, target: ImpactTarget) {
  if (target.field) {
    if (!target.program) throw new QueryError('"program" is required with "field"')
    const program = getProgram(project, target.program)
    const item = getItem(program, target.field)
    const copybook = program.copies.find((c) => c.resolved === item.file)
    // A field from a shared copybook affects every program that includes it and uses the field.
    const programs = copybook ? [...project.programs.values()].filter((p) => p.copies.some((c) => c.resolved === copybook.resolved)) : [program]
    const affected = programs
      .map((p) => {
        const local = p.byName.get(item.name)?.find((id) => p.items.get(id)?.file === item.file) ?? (p === program ? item.id : undefined)
        if (!local) return undefined
        const storage = overlapping(p, local)
        const downstream = (dataFlow(p, p.items.get(local)!, "downstream", 3).downstream as { field: string }[]).map((s) => s.field)
        const touched = new Set([...storage, ...downstream])
        const paragraphs = [...new Set(p.accesses.filter((a) => touched.has(a.item)).map((a) => a.paragraph))]
        if (paragraphs.length === 0 && p !== program) return undefined
        return {
          program: p.id,
          paragraphs,
          downstreamFields: downstream,
          passedTo: [...new Set(p.calls.filter((c) => c.using.some((u) => touched.has(u))).map((c) => c.target ?? `(dynamic ${c.via})`))],
        }
      })
      .filter((x) => x !== undefined)
    return {
      target: { program: program.id, field: item.id, definedIn: item.file, ...(copybook ? { copybook: copybook.name } : {}) },
      programs: affected,
      jobs: jobsOf(project, affected.map((a) => a.program)),
    }
  }
  if (target.copybook) {
    const name = target.copybook.toUpperCase().replace(/\.[A-Z]+$/, "")
    const files = project.copybooks.get(name)?.map((f) => project.rel(f))
    if (!files) throw new QueryError(`Unknown copybook "${target.copybook}".${SYSTEM_COPYBOOK.test(name) ? " It is a system copybook outside the project." : ""}`)
    const including = [...project.programs.values()].filter((p) => p.copies.some((c) => c.name === name))
    const programs = including.map((p) => {
      const fields = new Set([...p.items.values()].filter((i) => files.includes(i.file)).map((i) => i.id))
      const paragraphs = [...new Set(p.accesses.filter((a) => fields.has(a.item)).map((a) => a.paragraph))]
      const direct = p.copies.some((c) => c.name === name && c.file === p.file)
      return { program: p.id, file: p.file, direct, fields: fields.size, paragraphs, callers: callersOf(project, p.id, 2) }
    })
    return { target: { copybook: name, files }, programs, jobs: jobsOf(project, programs.map((p) => p.program)) }
  }
  if (target.program) {
    const program = getProgram(project, target.program)
    const callers = programCalls(project, program, "callers", 5)
    return {
      target: { program: program.id, file: program.file },
      callers: callers.callers,
      jobs: callers.jobs ?? [],
      sharedCopybooks: [...new Set(program.copies.filter((c) => c.resolved).map((c) => c.name))].map((name) => ({
        copybook: name,
        alsoUsedBy: [...project.programs.values()].filter((p) => p !== program && p.copies.some((c) => c.name === name)).map((p) => p.id),
      })),
    }
  }
  if (target.dataset) {
    const pattern = new RegExp(`^${target.dataset.toUpperCase().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
    const steps = project.steps.filter((s) => Object.values(s.dd).some((d) => pattern.test(d)))
    return {
      target: { dataset: target.dataset.toUpperCase() },
      steps: steps.map((s) => ({ job: s.job, step: s.step, file: s.file, program: s.program ?? null, proc: s.proc ?? null, dd: Object.entries(s.dd).filter(([, d]) => pattern.test(d)).map(([dd]) => dd) })),
      programs: steps.flatMap((s) => programFiles(project, s)),
    }
  }
  throw new QueryError('Give one of "copybook", "program", "field" (with "program") or "dataset"')
}

/** Files of the step's program that are assigned to the DD names pointing at the dataset. */
function programFiles(project: CobolProject, step: JobStep) {
  const program = step.program ? project.programs.get(step.program) : undefined
  if (!program) return []
  return program.files
    .filter((f) => f.assign && step.dd[f.assign] !== undefined)
    .map((f) => ({ program: program.id, file: f.name, dd: f.assign!, dataset: step.dd[f.assign!]!, records: [...program.items.values()].filter((i) => i.fileName === f.name && i.level === 1).map((i) => i.name) }))
}

export function find(project: CobolProject, query: string, limit: number) {
  const q = query.toUpperCase()
  const out: { kind: string; name: string; program?: string; file: string; line?: number }[] = []
  for (const p of project.programs.values()) if (p.id.includes(q)) out.push({ kind: "program", name: p.id, file: p.file })
  for (const [name, files] of project.copybooks) if (name.includes(q)) out.push({ kind: "copybook", name, file: files[0]! })
  for (const p of project.programs.values()) for (const para of p.paragraphs) if (para.name.includes(q)) out.push({ kind: para.kind, name: para.name, program: p.id, file: para.file, line: para.line })
  // Fields: one hit per definition site (copybook fields would otherwise repeat for every including program).
  const sites = new Set<string>()
  for (const p of project.programs.values())
    for (const item of p.items.values()) {
      if (!item.name.includes(q) || item.name === "FILLER") continue
      const site = `${item.file}:${item.line}`
      if (sites.has(site)) continue
      sites.add(site)
      out.push({ kind: "field", name: item.name, program: p.id, file: item.file, line: item.line })
    }
  const rank = (n: string) => (n === q ? 0 : n.startsWith(q) ? 1 : 2)
  return out.sort((a, b) => rank(a.name) - rank(b.name)).slice(0, limit)
}
