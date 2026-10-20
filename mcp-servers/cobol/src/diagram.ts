// Mermaid diagrams from the COBOL index (requirement 18): program calls with jobs, or one program's PERFORM graph.
import type { Program } from "./program.ts"
import type { CobolProject } from "./project.ts"

const node = (id: string) => id.replace(/[^A-Za-z0-9_]/g, "_")
const label = (text: string) => text.replace(/"/g, "'")

/** Program call graph: CALL/LINK/XCTL edges and the JCL steps that run each program. */
export function systemDiagram(project: CobolProject, options: { programs?: readonly string[]; jobs?: boolean } = {}): string {
  const only = options.programs?.length ? new Set(options.programs.map((p) => p.toUpperCase())) : undefined
  const lines = ["flowchart LR"]
  const seen = new Set<string>()
  const declare = (id: string, text: string, shape: "program" | "external" | "job") => {
    if (seen.has(id)) return
    seen.add(id)
    lines.push(shape === "job" ? `  ${id}[/"${label(text)}"/]` : shape === "external" ? `  ${id}(["${label(text)}"])` : `  ${id}["${label(text)}"]`)
  }
  for (const p of project.programs.values()) {
    if (only && !only.has(p.id) && !p.calls.some((c) => c.target && only.has(c.target))) continue
    declare(node(p.id), p.id, "program")
    for (const c of p.calls) {
      if (!c.target || (only && !only.has(p.id) && !only.has(c.target))) continue
      declare(node(c.target), c.target, project.programs.has(c.target) ? "program" : "external")
      lines.push(`  ${node(p.id)} -->|${c.kind}| ${node(c.target)}`)
    }
  }
  if (options.jobs !== false)
    for (const s of project.steps) {
      if (!s.program || !project.programs.has(s.program) || (only && !only.has(s.program))) continue
      const id = node(`job_${s.job}_${s.step}`)
      declare(id, `${s.job}.${s.step}`, "job")
      lines.push(`  ${id} --> ${node(s.program)}`)
    }
  return [...new Set(lines)].join("\n")
}

/** PERFORM / GO TO graph of one program. */
export function paragraphDiagram(program: Program): string {
  const lines = ["flowchart TD", `  ${node("(main)")}(["${program.id}"])`]
  for (const p of program.paragraphs) lines.push(`  ${node(p.name)}["${label(p.name)}"]`)
  for (const e of program.edges) lines.push(`  ${node(e.from)} ${e.kind === "goto" ? "-.->|GO TO|" : "-->"} ${node(e.to)}`)
  for (const c of program.calls) if (c.target) lines.push(`  ${node(c.paragraph)} -->|${c.kind}| ext_${node(c.target)}(["${c.target}"])`)
  return [...new Set(lines)].join("\n")
}
