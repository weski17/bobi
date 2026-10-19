// Queries over a CodeGraph: symbol lookup, callers/callees with depth, shortest call path, file dependencies.
import type { CodeGraph, CodeSymbol } from "./graph.ts"

export class QueryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "QueryError"
  }
}

export function findSymbols(graph: CodeGraph, query: string, limit = 20): CodeSymbol[] {
  const q = query.toLowerCase()
  const all = [...graph.symbols.values()].filter((s) => s.kind !== "module")
  const exact = all.filter((s) => s.name.toLowerCase() === q || s.id.toLowerCase() === q || s.id.toLowerCase().endsWith(`#${q}`))
  const partial = all.filter((s) => !exact.includes(s) && (s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)))
  return [...exact, ...partial].slice(0, limit)
}

/** Resolves a symbol id or an unambiguous name (also "Class.method"). */
export function resolveSymbol(graph: CodeGraph, ref: string): CodeSymbol {
  const direct = graph.symbols.get(ref)
  if (direct) return direct
  const matches = [...graph.symbols.values()].filter((s) => s.kind !== "module" && (s.name === ref || s.id.endsWith(`#${ref}`)))
  if (matches.length === 1) return matches[0]!
  if (matches.length === 0) throw new QueryError(`No symbol named "${ref}". Use find_symbol to search.`)
  throw new QueryError(`"${ref}" is ambiguous; use one of these ids: ${matches.map((m) => m.id).join(", ")}`)
}

export type Reached = { symbol: CodeSymbol; depth: number; via: string }

/** Breadth-first walk over call edges (callees) or reverse edges (callers). */
export function walkCalls(graph: CodeGraph, start: CodeSymbol, direction: "callers" | "callees", depth = 1): Reached[] {
  const edges = direction === "callees" ? graph.calls : graph.callers
  const seen = new Set([start.id])
  const out: Reached[] = []
  let frontier = [start.id]
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = []
    for (const id of frontier)
      for (const target of [...(edges.get(id) ?? [])].sort()) {
        if (seen.has(target)) continue
        seen.add(target)
        next.push(target)
        out.push({ symbol: graph.symbols.get(target)!, depth: d, via: id })
      }
    frontier = next
  }
  return out
}

/** Shortest call chain from `from` to `to`, or undefined. */
export function callPath(graph: CodeGraph, from: CodeSymbol, to: CodeSymbol, maxDepth = 8): CodeSymbol[] | undefined {
  const previous = new Map<string, string>([[from.id, ""]])
  let frontier = [from.id]
  for (let d = 0; d < maxDepth && frontier.length; d++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const target of [...(graph.calls.get(id) ?? [])].sort()) {
        if (previous.has(target)) continue
        previous.set(target, id)
        if (target === to.id) {
          const path: CodeSymbol[] = []
          for (let cur = target; cur; cur = previous.get(cur)!) path.unshift(graph.symbols.get(cur)!)
          return path
        }
        next.push(target)
      }
    }
    frontier = next
  }
  return undefined
}

export function resolveFile(graph: CodeGraph, file: string): string {
  const normalized = file.replace(/^\.\//, "").replaceAll("\\", "/")
  const relative = normalized.startsWith(graph.root) ? graph.rel(normalized) : normalized
  const known = [...graph.symbols.values()].some((s) => s.file === relative)
  if (!known) throw new QueryError(`Unknown file "${file}" (paths are relative to the project root).`)
  return relative
}

export function fileDependencies(graph: CodeGraph, file: string, direction: "dependencies" | "dependents", depth = 1): { file: string; depth: number }[] {
  const edges = direction === "dependencies" ? graph.imports : graph.importers
  const seen = new Set([file])
  const out: { file: string; depth: number }[] = []
  let frontier = [file]
  for (let d = 1; d <= depth && frontier.length; d++) {
    const next: string[] = []
    for (const f of frontier)
      for (const target of [...(edges.get(f) ?? [])].sort()) {
        if (seen.has(target)) continue
        seen.add(target)
        next.push(target)
        out.push({ file: target, depth: d })
      }
    frontier = next
  }
  return out
}
