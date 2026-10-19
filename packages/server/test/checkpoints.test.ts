import { afterEach, beforeEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { bobiPaths, ensureCheckpointRepo, shadowDir } from "../src/index.ts"

let root: string
let paths: ReturnType<typeof bobiPaths>
beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "bobi-ckpt-")))
  paths = bobiPaths({ BOBI_HOME: path.join(root, "home") })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const git = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", ...args], { cwd }).stdout.toString().trim()

test("a project without git gets a hidden repository and only a pointer file", () => {
  const project = path.join(root, "plain")
  mkdirSync(project)
  const repo = ensureCheckpointRepo(project, paths)
  expect(repo).toEqual({ kind: "shadow", gitDir: shadowDir(paths, project), created: true })
  expect(statSync(path.join(project, ".git")).isFile()).toBe(true)
  expect(readFileSync(path.join(project, ".git"), "utf8")).toContain(`gitdir: ${shadowDir(paths, project)}`)
  expect(existsSync(path.join(shadowDir(paths, project), "HEAD"))).toBe(true)
  expect(git(project, "log", "--format=%s")).toBe("bobi: checkpoint repository")
})

test("is idempotent", () => {
  const project = path.join(root, "again")
  mkdirSync(project)
  ensureCheckpointRepo(project, paths)
  expect(ensureCheckpointRepo(project, paths)).toEqual({ kind: "shadow", gitDir: shadowDir(paths, project), created: false })
  expect(git(project, "rev-list", "--count", "HEAD")).toBe("1")
})

test("leaves real git repositories and their subdirectories alone", () => {
  const project = path.join(root, "real")
  mkdirSync(path.join(project, "src"), { recursive: true })
  git(project, "init", "-q")
  expect(ensureCheckpointRepo(project, paths)).toEqual({ kind: "git", root: project })
  expect(ensureCheckpointRepo(path.join(project, "src"), paths)).toEqual({ kind: "git", root: project })
  expect(existsSync(path.join(project, "src", ".git"))).toBe(false)
})

test("a subdirectory of a shadow project uses the parent and gets no second repository", () => {
  const project = path.join(root, "parent")
  mkdirSync(path.join(project, "sub"), { recursive: true })
  ensureCheckpointRepo(project, paths)
  expect(ensureCheckpointRepo(path.join(project, "sub"), paths)).toEqual({ kind: "git", root: project })
})

test("a git worktree pointer that is not Bobi's counts as a real repository", () => {
  const main = path.join(root, "main")
  mkdirSync(main)
  git(main, "init", "-q")
  Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x"], { cwd: main })
  const worktree = path.join(root, "wt")
  git(main, "worktree", "add", "-q", worktree)
  expect(ensureCheckpointRepo(worktree, paths)).toEqual({ kind: "git", root: worktree })
})
