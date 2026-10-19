// Loads modes: built-in → $BOBI_HOME/custom_modes.yaml → <project>/.bobi/custom_modes.yaml.
// A mode with the same slug replaces the earlier one entirely (project wins).
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { parseModes, type Mode } from "./schema.ts"

export const BUILTIN_FILE = path.resolve(import.meta.dir, "..", "builtin-modes.yaml")
export const DEFAULT_MODE = "code"

export type LoadModesOptions = {
  /** BOBI_HOME (default ~/.bobi) – holds the global custom_modes.yaml. */
  readonly globalDir: string
  readonly project: string
  readonly builtinFile?: string
  /** Load the project's .bobi/custom_modes.yaml (only for trusted projects). Default true. */
  readonly includeProject?: boolean
}

export function modeFiles(options: LoadModesOptions): string[] {
  return [path.join(options.globalDir, "custom_modes.yaml"), path.join(options.project, ".bobi", "custom_modes.yaml")]
}

export function loadModes(options: LoadModesOptions): Mode[] {
  const builtinFile = options.builtinFile ?? BUILTIN_FILE
  const byslug = new Map<string, Mode>()
  const [globalFile, projectFile] = modeFiles(options)
  for (const file of [builtinFile, globalFile!, ...(options.includeProject === false ? [] : [projectFile!])]) {
    if (!existsSync(file)) continue
    for (const mode of parseModes(readFileSync(file, "utf8"), file)) byslug.set(mode.slug, mode)
  }
  return [...byslug.values()]
}
