// Checkpoints for projects without git (ADR-0006, decided 2026-10-19): the engine's snapshots need a git
// repository, so Bobi gives such projects a hidden one. The repository lives under ~/.bobi/data/shadow;
// the project only gets a `.git` pointer file ("gitdir: …"). Projects inside a git repository are untouched.
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import type { BobiPaths } from "./paths.ts"

export type CheckpointRepo =
  | { readonly kind: "git"; readonly root: string }
  | { readonly kind: "shadow"; readonly gitDir: string; readonly created: boolean }

export const SHADOW_MARKER = "bobi.shadow"

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { ...process.env, GIT_AUTHOR_NAME: "Bobi", GIT_AUTHOR_EMAIL: "bobi@localhost", GIT_COMMITTER_NAME: "Bobi", GIT_COMMITTER_EMAIL: "bobi@localhost" },
    stdout: "pipe",
    stderr: "pipe",
  })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`)
  return result.stdout.toString().trim()
}

/** Nearest directory at or above `dir` that contains `.git` (a directory or a pointer file). */
function findGitRoot(dir: string): string | undefined {
  let current = dir
  while (true) {
    if (existsSync(path.join(current, ".git"))) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

export function shadowDir(paths: BobiPaths, project: string): string {
  return path.join(paths.data, "shadow", `${createHash("sha256").update(project).digest("hex").slice(0, 16)}.git`)
}

export function ensureCheckpointRepo(directory: string, paths: BobiPaths): CheckpointRepo {
  const project = realpathSync(directory)
  const root = findGitRoot(project)
  if (root) {
    const pointer = path.join(root, ".git")
    const shadow = existsSync(pointer) && !existsSync(path.join(pointer, "HEAD")) ? readFileSync(pointer, "utf8").match(/^gitdir:\s*(.+)$/m)?.[1]?.trim() : undefined
    const marked = Bun.spawnSync(["git", "config", "--get", SHADOW_MARKER], { cwd: root, stdout: "pipe", stderr: "ignore" }).stdout.toString().trim() === "true"
    if (shadow && root === project && marked) {
      return { kind: "shadow", gitDir: shadow, created: false }
    }
    return { kind: "git", root }
  }
  const gitDir = shadowDir(paths, project)
  mkdirSync(path.dirname(gitDir), { recursive: true })
  // --separate-git-dir writes the `.git` pointer file into the project.
  git(project, "init", "-q", `--separate-git-dir=${gitDir}`, project)
  git(project, "config", SHADOW_MARKER, "true")
  // A root commit gives the project a stable identity in the engine.
  git(project, "commit", "-q", "--allow-empty", "-m", "bobi: checkpoint repository")
  return { kind: "shadow", gitDir, created: true }
}
