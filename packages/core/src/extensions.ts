// Skills (SKILL.md) and custom slash commands (requirement 11).
//   Skills:   $BOBI_HOME/skills/<name>/SKILL.md, <project>/.bobi/skills/<name>/SKILL.md
//   Commands: built-in (defaults/commands/*.md), $BOBI_HOME/commands/*.md, <project>/.bobi/commands/*.md
// Project files only for trusted projects (ADR-0014). Later sources replace earlier ones with the same name.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

export const BUILTIN_COMMANDS = path.resolve(import.meta.dir, "..", "defaults", "commands")

export type SkillFile = { name: string; description?: string; path: string; content: string }
export type CommandFile = { name: string; description?: string; mode?: string; template: string; path: string }

const NAME = /^[a-z0-9][a-z0-9-]*$/

/** Splits `---\nyaml\n---\nbody` into frontmatter and body. */
export function frontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!match) return { data: {}, body: text }
  let data: unknown
  try {
    data = Bun.YAML.parse(match[1]!)
  } catch {
    data = {}
  }
  return { data: data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {}, body: match[2]! }
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined)

export function readSkills(dirs: readonly string[]): SkillFile[] {
  const byName = new Map<string, SkillFile>()
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir).sort()) {
      const file = path.join(dir, entry, "SKILL.md")
      if (!statSync(file, { throwIfNoEntry: false })?.isFile()) continue
      const { data, body } = frontmatter(readFileSync(file, "utf8"))
      const name = str(data.name) ?? entry
      if (!NAME.test(name) || !body.trim()) continue
      byName.set(name, { name, description: str(data.description), path: file, content: body.trim() })
    }
  }
  return [...byName.values()]
}

export function readCommands(dirs: readonly string[]): CommandFile[] {
  const byName = new Map<string, CommandFile>()
  for (const dir of dirs) {
    if (!existsSync(dir)) continue
    for (const entry of readdirSync(dir).sort()) {
      if (!entry.endsWith(".md")) continue
      const name = entry.slice(0, -3)
      if (!NAME.test(name)) continue
      const file = path.join(dir, entry)
      const { data, body } = frontmatter(readFileSync(file, "utf8"))
      if (!body.trim()) continue
      byName.set(name, { name, description: str(data.description), mode: str(data.mode), template: body.trim(), path: file })
    }
  }
  return [...byName.values()]
}

/** Inserts the user's text: `$ARGUMENTS` placeholders, else appended after the template. */
export function expandTemplate(template: string, args: string): string {
  const text = args.trim()
  if (template.includes("$ARGUMENTS")) return template.replaceAll("$ARGUMENTS", text || "(none)")
  return text ? `${template}\n\n${text}` : template
}

export function extensionDirs(globalDir: string, project: string, trusted: boolean) {
  const projectDir = path.join(project, ".bobi")
  return {
    skills: [path.join(globalDir, "skills"), ...(trusted ? [path.join(projectDir, "skills")] : [])],
    commands: [BUILTIN_COMMANDS, path.join(globalDir, "commands"), ...(trusted ? [path.join(projectDir, "commands")] : [])],
  }
}
