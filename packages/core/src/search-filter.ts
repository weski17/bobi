// Removes .bobiignore'd files from grep/glob results and re-renders the model text the engine would produce.
import path from "node:path"
import type { BobiIgnore } from "./bobiignore.ts"

type Entry = { path: string }
type Match = { entry: Entry; line: number; text: string }

export function filterGlob(entries: readonly Entry[], base: string, ignored: BobiIgnore): { entries: Entry[]; removed: number } {
  const kept = entries.filter((e) => !ignored.ignores(path.resolve(base, e.path)))
  return { entries: kept, removed: entries.length - kept.length }
}

export function filterGrep(matches: readonly Match[], base: string, ignored: BobiIgnore): { matches: Match[]; removed: number } {
  const kept = matches.filter((m) => !ignored.ignores(path.resolve(base, m.entry.path)))
  return { matches: kept, removed: matches.length - kept.length }
}

const note = (removed: number) => (removed ? [``, `(${removed} result${removed === 1 ? "" : "s"} hidden by .bobiignore)`] : [])

export function renderGlob(entries: readonly Entry[], removed: number): string {
  return [...(entries.length === 0 ? ["No files found"] : entries.map((e) => e.path)), ...note(removed)].join("\n")
}

export function renderGrep(matches: readonly Match[], removed: number): string {
  const lines = matches.length === 0 ? ["No matches found"] : [`Found ${matches.length} matches`]
  let current = ""
  for (const match of matches) {
    if (current !== match.entry.path) {
      if (current) lines.push("")
      current = match.entry.path
      lines.push(`${match.entry.path}:`)
    }
    lines.push(`  Line ${match.line}: ${match.text}`)
  }
  return [...lines, ...note(removed)].join("\n")
}
