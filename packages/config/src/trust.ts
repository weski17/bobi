// Project trust: files from a repository that steer Bobi (AGENTS.md, .bobi/config.jsonc, custom modes, rules) are
// only used after the user trusts the project. The decision is stored with a fingerprint of those files and is
// asked again when they change. Projects without such files need no decision.
import { createHash } from "node:crypto"
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { findProjectRoot } from "./load.ts"

export type TrustStatus = "none" | "trusted" | "untrusted" | "unknown"

type Entry = { trusted: boolean; fingerprint: string; decidedAt: string }
type StoreFile = { version: 1; projects: Record<string, Entry> }

/** More files than this cannot be fingerprinted; such a project is treated as untrusted (the rule loader uses the same limit). */
export const TRUST_MAX_FILES = 500

// Symbolic links are neither fingerprinted nor loaded: a link could pull any file into the system prompt while the
// trust prompt only shows its name (review 2026-11-19, M3).
function walk(dir: string, out: string[], depth = 0) {
  if (depth > 5 || out.length > TRUST_MAX_FILES || !existsSync(dir) || lstatSync(dir).isSymbolicLink()) return
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name)
    const stat = lstatSync(full, { throwIfNoEntry: false })
    if (stat?.isDirectory()) walk(full, out, depth + 1)
    else if (stat?.isFile()) out.push(full)
  }
}

const NOT_SEARCHED = new Set([".git", "node_modules", "vendor", "dist", "build", "out", "target", ".venv", "__pycache__"])

/** Every AGENTS.md in the project: the rule loader reads those between the root and the folder Bobi starts in. */
function agentsFiles(dir: string, out: string[], depth = 0) {
  if (depth > 8 || out.length > TRUST_MAX_FILES) return
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isFile() && entry.name === "AGENTS.md") out.push(path.join(dir, entry.name))
    else if (entry.isDirectory() && !NOT_SEARCHED.has(entry.name) && entry.name !== ".bobi") agentsFiles(path.join(dir, entry.name), out, depth + 1)
  }
}

/** Files in `project` that influence Bobi's behaviour. */
export function trustFiles(project: string): string[] {
  const files: string[] = []
  // .bobiignore only restricts Bobi and is honoured without trust, so it is not part of the fingerprint.
  agentsFiles(project, files)
  const bobi = path.join(project, ".bobi")
  if (existsSync(bobi)) {
    for (const name of readdirSync(bobi).sort()) {
      const full = path.join(bobi, name)
      const stat = lstatSync(full)
      if ((name === "config.jsonc" || name === "custom_modes.yaml") && stat.isFile()) files.push(full)
      else if ((name === "rules" || name.startsWith("rules-") || name === "skills" || name === "commands") && stat.isDirectory()) walk(full, files)
    }
  }
  return files
}

export function fingerprint(project: string, files: readonly string[]): string {
  const hash = createHash("sha256")
  // Each part is length-prefixed, so two different file layouts cannot produce the same byte stream.
  const part = (data: Buffer | string) => hash.update(`${Buffer.byteLength(data)}:`).update(data)
  for (const file of files) {
    part(path.relative(project, file))
    part(readFileSync(file))
  }
  return hash.digest("hex")
}

export class TrustStore {
  readonly file: string

  constructor(globalDir: string) {
    // A directory of its own so the sandbox can mount it read-only (a bind-mounted single file would keep
    // pointing at the old inode after the atomic rename in decide()).
    this.file = path.join(globalDir, "trust", "projects.json")
  }

  private read(): StoreFile {
    try {
      const data = JSON.parse(readFileSync(this.file, "utf8")) as StoreFile
      return data?.version === 1 && data.projects && typeof data.projects === "object" ? data : { version: 1, projects: {} }
    } catch {
      return { version: 1, projects: {} }
    }
  }

  /** Trust is decided for the project root (nearest .bobi or .git), the same root the config loader uses. */
  status(directory: string): TrustStatus {
    const project = realpathSync(findProjectRoot(directory))
    const files = trustFiles(project)
    if (files.length === 0) return "none"
    if (files.length > TRUST_MAX_FILES) return "untrusted"
    const entry = this.read().projects[project]
    if (!entry || entry.fingerprint !== fingerprint(project, files)) return "unknown"
    return entry.trusted ? "trusted" : "untrusted"
  }

  /** Whether project files may be used. */
  isTrusted(directory: string): boolean {
    const status = this.status(directory)
    return status === "none" || status === "trusted"
  }

  /** Removes the decision for a project (for throw-away worktrees). */
  forget(directory: string): void {
    const project = realpathSync(findProjectRoot(directory))
    const data = this.read()
    if (!(project in data.projects)) return
    delete data.projects[project]
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
  }

  decide(directory: string, trusted: boolean): void {
    const project = realpathSync(findProjectRoot(directory))
    const data = this.read()
    data.projects[project] = { trusted, fingerprint: fingerprint(project, trustFiles(project)), decidedAt: new Date().toISOString() }
    mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    renameSync(tmp, this.file)
  }
}
