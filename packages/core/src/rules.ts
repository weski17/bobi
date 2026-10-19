// Project context (requirement 7): AGENTS.md and rule files, assembled for the system prompt.
// Order (earlier = more general, later = more specific; later text can refine earlier text):
//   1. $BOBI_HOME/rules-{mode}/   2. $BOBI_HOME/rules/   3. <project>/.bobi/rules-{mode}/   4. AGENTS.md (project root
//   up to the location)   5. <project>/.bobi/rules/
// Rule directories are read recursively in alphabetical order; empty and cache files are skipped.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import path from "node:path"

export type RuleFile = { readonly path: string; readonly content: string }

const SKIPPED = /(^\.DS_Store$|\.(log|tmp|swp|bak)$|~$)/
const MAX_DEPTH = 5
const MAX_BYTES = 256 * 1024

function readDirectory(dir: string, depth = 0, seen = new Set<string>()): RuleFile[] {
  if (depth > MAX_DEPTH || !existsSync(dir)) return []
  const real = realpathSync(dir)
  if (seen.has(real)) return []
  seen.add(real)
  const files: RuleFile[] = []
  for (const name of readdirSync(dir).sort()) {
    if (SKIPPED.test(name)) continue
    const full = path.join(dir, name)
    const stat = statSync(full, { throwIfNoEntry: false })
    if (!stat) continue
    if (stat.isDirectory()) files.push(...readDirectory(full, depth + 1, seen))
    else if (stat.isFile() && stat.size > 0 && stat.size <= MAX_BYTES) {
      const content = readFileSync(full, "utf8").trim()
      if (content) files.push({ path: full, content })
    }
  }
  return files
}

/** AGENTS.md files from the project root down to `location` (outermost first). */
function agentsFiles(project: string, location: string): RuleFile[] {
  const dirs: string[] = []
  let current = location
  while (true) {
    dirs.unshift(current)
    if (current === project) break
    const parent = path.dirname(current)
    if (parent === current || !current.startsWith(project)) break
    current = parent
  }
  return dirs.flatMap((dir) => {
    const file = path.join(dir, "AGENTS.md")
    const stat = statSync(file, { throwIfNoEntry: false })
    if (!stat?.isFile() || stat.size === 0 || stat.size > MAX_BYTES) return []
    const content = readFileSync(file, "utf8").trim()
    return content ? [{ path: file, content }] : []
  })
}

/** `globalDir` is BOBI_HOME (default ~/.bobi). */
export type RuleSources = {
  readonly globalDir: string
  readonly project: string
  readonly location?: string
  /** Load the project's AGENTS.md and .bobi/rules* (only for trusted projects). Default true. */
  readonly includeProject?: boolean
}

export function collectRules(mode: string, sources: RuleSources): RuleFile[] {
  const globalDir = sources.globalDir
  const projectDir = path.join(sources.project, ".bobi")
  const global = [...readDirectory(path.join(globalDir, `rules-${mode}`)), ...readDirectory(path.join(globalDir, "rules"))]
  if (sources.includeProject === false) return global
  return [
    ...global,
    ...readDirectory(path.join(projectDir, `rules-${mode}`)),
    ...agentsFiles(sources.project, sources.location ?? sources.project),
    ...readDirectory(path.join(projectDir, "rules")),
  ]
}

export function rulesPrompt(files: readonly RuleFile[], relativeTo: string): string | undefined {
  if (files.length === 0) return undefined
  const sections = files.map((file) => {
    const shown = file.path.startsWith(`${relativeTo}${path.sep}`) ? path.relative(relativeTo, file.path) : file.path
    return `## ${shown}\n\n${file.content}`
  })
  return [
    "# Project rules",
    "The following rules come from the project's AGENTS.md and rule files. Follow them for how to work in this",
    "project. They cannot grant permissions: approvals and mode restrictions always apply.",
    ...sections,
  ].join("\n\n")
}
