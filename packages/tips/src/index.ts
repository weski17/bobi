// Code tips for a file: picks the analyzer by extension; other languages get no tips.
import path from "node:path"
import { analyzeCobol } from "./cobol.ts"
import { DEFAULT_LIMITS, type Limits, type Tip } from "./types.ts"
import { analyzeTypeScript } from "./typescript.ts"

export { analyzeCobol } from "./cobol.ts"
export { analyzeTypeScript } from "./typescript.ts"
export { DEFAULT_LIMITS } from "./types.ts"
export type { Limits, Severity, Tip } from "./types.ts"

const TS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"])
const COBOL = new Set([".cbl", ".cob", ".cobol", ".cpy"])
/** Files larger than this are skipped (generated or minified code). */
export const MAX_BYTES = 500_000

export function supported(file: string): "typescript" | "cobol" | undefined {
  const ext = path.extname(file).toLowerCase()
  if (TS.has(ext) && !file.endsWith(".d.ts")) return "typescript"
  if (COBOL.has(ext)) return "cobol"
  return undefined
}

export function analyze(file: string, text: string, limits: Partial<Limits> = {}): Tip[] {
  const kind = supported(file)
  if (!kind || text.length > MAX_BYTES) return []
  const all = { ...DEFAULT_LIMITS, ...limits }
  return kind === "typescript" ? analyzeTypeScript(text, file, all) : analyzeCobol(text, file, all)
}
export { newTips, ratchet } from "./ratchet.ts"
export type { FileChange } from "./ratchet.ts"
