// Architecture diagram from the code graph (requirement 18): file or directory dependencies as Mermaid.
import path from "node:path"
import type { CodeGraph } from "./graph.ts"

const node = (id: string) => `n_${id.replace(/[^A-Za-z0-9_]/g, "_")}`

/**
 * Import dependencies. Small projects show files grouped by directory; larger ones (more than `maxNodes`
 * files) are aggregated to directories down to `depth` levels.
 */
export function dependencyDiagram(graph: CodeGraph, options: { maxNodes?: number; depth?: number } = {}): string {
  // The graph keys files by their project-relative path.
  const files = [...new Set([...graph.imports.keys(), ...graph.importers.keys()])].sort()
  const aggregate = files.length > (options.maxNodes ?? 60)
  const depth = options.depth ?? 2
  const unit = (file: string) => {
    if (!aggregate) return file
    const dir = path.posix.dirname(file)
    return dir === "." ? "(root)" : dir.split("/").slice(0, depth).join("/")
  }
  const lines = ["flowchart LR"]
  const units = [...new Set(files.map(unit))].sort()
  if (aggregate) for (const u of units) lines.push(`  ${node(u)}["${u}/"]`)
  else {
    const byDir = new Map<string, string[]>()
    for (const f of units) byDir.set(path.posix.dirname(f), [...(byDir.get(path.posix.dirname(f)) ?? []), f])
    for (const [dir, members] of byDir) {
      lines.push(`  subgraph ${node(`dir_${dir}`)}["${dir}"]`)
      for (const f of members) lines.push(`    ${node(f)}["${path.posix.basename(f)}"]`)
      lines.push("  end")
    }
  }
  const edges = new Set<string>()
  for (const [from, targets] of graph.imports)
    for (const to of targets) {
      const a = unit(from)
      const b = unit(to)
      if (a !== b) edges.add(`  ${node(a)} --> ${node(b)}`)
    }
  return [...lines, ...[...edges].sort()].join("\n")
}
