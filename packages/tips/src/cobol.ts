// Tips for COBOL, from Bobi's COBOL parser (one file; copybooks are not needed for these checks).
import { expand, parseProgram } from "@bobi/mcp-cobol"
import type { Limits, Tip } from "./types.ts"

const OPENERS = new Set(["IF", "EVALUATE", "SEARCH"])
const CLOSERS = new Set(["END-IF", "END-EVALUATE", "END-SEARCH", "END-PERFORM"])

export function analyzeCobol(text: string, file: string, limits: Limits): Tip[] {
  const { tokens } = expand(text, file, { resolve: () => undefined, read: () => "" })
  const program = parseProgram(tokens, file, [])
  const tips: Tip[] = []
  const lastLine = text.split("\n").length
  const paragraphs = program.paragraphs.filter((p) => p.file === file)
  const ranges = paragraphs.map((p, i) => ({ name: p.name, line: p.line, endLine: (paragraphs[i + 1]?.line ?? lastLine + 1) - 1 }))
  const paragraphAt = (line: number) => ranges.findLast((r) => r.line <= line)

  for (const r of ranges) {
    // Count code lines only (comments and blank lines do not make a paragraph long).
    const codeLines = new Set(tokens.filter((t) => t.file === file && t.line >= r.line && t.line <= r.endLine).map((t) => t.line)).size
    if (codeLines > limits.functionLines)
      tips.push({ rule: "function-length", severity: "warning", message: `Paragraph ${r.name} has ${codeLines} lines of code (limit ${limits.functionLines}).`, line: r.line, endLine: r.endLine, symbol: r.name })
  }

  // Nesting of IF / EVALUATE / inline PERFORM; a period ends every open scope.
  const procedure = tokens.findIndex((t, i) => t.text === "PROCEDURE" && tokens[i + 1]?.text === "DIVISION")
  let depth = 0
  const deepest = new Map<string, number>()
  for (let i = Math.max(procedure, 0); procedure >= 0 && i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.kind === "period") depth = 0
    else if (t.kind === "word" && OPENERS.has(t.text)) depth++
    else if (t.kind === "word" && t.text === "PERFORM" && ["UNTIL", "VARYING", "WITH", "TEST"].includes(tokens[i + 1]?.text ?? "")) depth++
    else if (t.kind === "word" && CLOSERS.has(t.text)) depth = Math.max(0, depth - 1)
    const p = paragraphAt(t.line)
    if (p && t.file === file && depth > (deepest.get(p.name) ?? 0)) deepest.set(p.name, depth)
    if (t.kind === "word" && t.text === "ALTER" && t.file === file)
      tips.push({ rule: "alter", severity: "warning", message: "ALTER changes the target of a GO TO at run time; the control flow cannot be read from the source. Replace it with a flag and PERFORM.", line: t.line, endLine: t.line, ...(p ? { symbol: p.name } : {}) })
  }
  for (const r of ranges) {
    const d = deepest.get(r.name) ?? 0
    if (d > limits.nesting)
      tips.push({ rule: "nesting", severity: "warning", message: `Paragraph ${r.name} nests conditions ${d} levels deep (limit ${limits.nesting}).`, line: r.line, endLine: r.endLine, symbol: r.name })
  }
  for (const e of program.edges) {
    if (e.file !== file) continue
    if (e.kind === "goto")
      tips.push({ rule: "go-to", severity: "info", message: `GO TO ${e.to} jumps without returning; prefer PERFORM for readable control flow.`, line: e.line, endLine: e.line, symbol: e.from })
    if (e.thru)
      tips.push({ rule: "perform-thru", severity: "info", message: `PERFORM ${e.to} THRU ${e.thru} runs every paragraph in between; adding a paragraph there changes behaviour.`, line: e.line, endLine: e.line, symbol: e.from })
  }
  return tips.sort((a, b) => a.line - b.line)
}
