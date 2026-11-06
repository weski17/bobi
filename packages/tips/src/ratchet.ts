// "No new tips": compares the tips of a file before and after a change, so a pull request is judged only by what it
// adds. Tips are matched by rule and function name (not by line, which moves), so reformatting does not matter and
// old findings in touched files do not block a change that leaves them as they are.
import { analyze } from "./index.ts"
import type { Limits, Tip } from "./types.ts"

export type FileChange = {
  readonly file: string
  /** Text before the change; undefined for a new file. */
  readonly before?: string
  /** Text after the change. */
  readonly after: string
}

const key = (t: Tip) => `${t.rule}|${t.symbol ?? ""}`

/** The tips of `after` that `before` did not already have (per rule and function, counted). */
export function newTips(file: string, before: string | undefined, after: string, limits: Partial<Limits> = {}): Tip[] {
  const known = new Map<string, number>()
  if (before !== undefined) for (const t of analyze(file, before, limits)) known.set(key(t), (known.get(key(t)) ?? 0) + 1)
  return analyze(file, after, limits).filter((t) => {
    const left = known.get(key(t)) ?? 0
    if (left > 0) {
      known.set(key(t), left - 1)
      return false
    }
    return true
  })
}

export function ratchet(changes: readonly FileChange[], limits: Partial<Limits> = {}): { file: string; tips: Tip[] }[] {
  return changes.map((c) => ({ file: c.file, tips: newTips(c.file, c.before, c.after, limits) })).filter((r) => r.tips.length > 0)
}
