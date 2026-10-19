// Prints the absolute paths in <project> that .bobiignore excludes (topmost entries only, one per line).
// Used by sandbox/bobi-sandbox.sh to hide them inside the container.
import { readdirSync } from "node:fs"
import path from "node:path"
import { BobiIgnore } from "../packages/core/src/bobiignore.ts"

export function ignoredPaths(project: string, limit = 2000): string[] {
  const ignored = new BobiIgnore(project)
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= limit) return
      if (entry.name === ".git") continue
      const full = path.join(dir, entry.name)
      if (ignored.ignores(full)) out.push(entry.isDirectory() ? `${full}/` : full)
      else if (entry.isDirectory() && !entry.isSymbolicLink()) walk(full)
    }
  }
  walk(project)
  return out
}

if (import.meta.main) {
  const project = process.argv[2]
  if (!project) {
    console.error("usage: bun scripts/bobiignore-paths.ts <project>")
    process.exit(2)
  }
  for (const p of ignoredPaths(path.resolve(project))) console.log(p)
}
