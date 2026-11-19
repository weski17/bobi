// .bobiignore (requirement 7): gitignore syntax at the project root. Ignored files are refused by file tools,
// removed from search results, and blocked as arguments of common file-reading shell commands.
// Not a security boundary: arbitrary shell commands can still reach them – the sandbox is the boundary.
import { readFileSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import ignore, { type Ignore } from "ignore"

export const IGNORE_FILE = ".bobiignore"

/** Shell commands whose path arguments are checked (the documented, limited protection). */
export const READ_COMMANDS = new Set([
  "cat", "head", "tail", "less", "more", "bat", "nl", "tac", "strings", "xxd", "od", "hexdump", "base64",
  "grep", "egrep", "fgrep", "rg", "ag", "sed", "awk", "cut", "sort", "uniq", "wc", "diff", "cp", "mv", "scp",
  "rsync", "tar", "zip", "gzip", "file", "source", ".", "open", "vim", "vi", "nano", "code",
])

export class BobiIgnore {
  private cache: { mtimeMs: number; matcher: Ignore } | undefined

  constructor(readonly project: string) {}

  private matcher(): Ignore | undefined {
    const file = path.join(this.project, IGNORE_FILE)
    const stat = statSync(file, { throwIfNoEntry: false })
    if (!stat?.isFile()) return (this.cache = undefined)
    if (this.cache?.mtimeMs !== stat.mtimeMs) this.cache = { mtimeMs: stat.mtimeMs, matcher: ignore().add(readFileSync(file, "utf8")) }
    return this.cache.matcher
  }

  /**
   * True when `target` (absolute or relative to the project) is ignored. Paths outside the project are not governed.
   * A symbolic link counts as the file it points to: `notes.txt -> .env` is as blocked as `.env` (review 2026-11-19, M1).
   */
  ignores(target: string): boolean {
    const matcher = this.matcher()
    if (!matcher) return false
    const absolute = path.resolve(this.project, target)
    if (this.matches(matcher, this.project, absolute)) return true
    const real = realPath(absolute)
    return real !== undefined && this.matches(matcher, realPath(this.project) ?? this.project, real)
  }

  private matches(matcher: Ignore, root: string, absolute: string): boolean {
    const relative = path.relative(root, absolute).replaceAll("\\", "/")
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false
    if (relative === IGNORE_FILE) return false
    return matcher.ignores(relative) || matcher.ignores(`${relative}/`)
  }

  message(target: string): string {
    return `Access to ${path.relative(this.project, path.resolve(this.project, target)) || target} is blocked by ${IGNORE_FILE}. Continue without this file, or ask the user to change ${IGNORE_FILE}.`
  }
}

function realPath(file: string): string | undefined {
  try {
    return realpathSync(file)
  } catch {
    return undefined
  }
}

/** Paths named in an engine patch ("*** Add/Update/Delete File: x", "*** Move to: y"). */
export function patchPaths(patchText: string): string[] {
  return [...patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm)].map((m) => (m[1] ?? m[2])!.trim())
}

/** Splits a shell command into simple commands and their words (quotes respected, no expansion). */
export function shellWords(command: string): string[][] {
  const commands: string[][] = []
  let words: string[] = []
  let word = ""
  let quote: string | undefined
  let started = false
  const endWord = () => {
    if (started) words.push(word)
    word = ""
    started = false
  }
  const endCommand = () => {
    endWord()
    if (words.length) commands.push(words)
    words = []
  }
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!
    if (quote) {
      if (ch === quote) quote = undefined
      else if (ch === "\\" && quote === '"' && i + 1 < command.length) word += command[++i]
      else word += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      started = true
    } else if (ch === "\\" && i + 1 < command.length) {
      word += command[++i]
      started = true
    } else if (/\s/.test(ch)) endWord()
    else if (ch === ";" || ch === "|" || ch === "&" || ch === "(" || ch === ")" || ch === "\n") endCommand()
    else if (ch === "<" || ch === ">") {
      endWord()
      // redirection targets are paths too: keep them as words of the current command
    } else {
      word += ch
      started = true
    }
  }
  endCommand()
  return commands
}

/** The first ignored path argument of a file-reading command in `command`, if any. */
export function blockedShellPath(command: string, cwd: string, ignored: BobiIgnore): string | undefined {
  for (const words of shellWords(command)) {
    const [program, ...args] = words
    const name = program ? path.basename(program) : ""
    // Redirections (`< secret.txt`, `> out`) are checked for every command.
    const candidates = READ_COMMANDS.has(name) ? args : []
    for (const arg of [...candidates, ...redirectTargets(command)]) {
      if (arg.startsWith("-") || arg.includes("://")) continue
      if (ignored.ignores(path.resolve(cwd, arg))) return arg
    }
  }
  return undefined
}

function redirectTargets(command: string): string[] {
  return [...command.matchAll(/(?:^|[^\d&])<\s*([^\s;|&<>]+)/g)].map((m) => m[1]!.replace(/^['"]|['"]$/g, ""))
}
