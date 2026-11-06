// Command line of the `bobi` application (ADR-0013). Only Bobi's own commands exist.

export const VERSION = "0.1.0"

export type Command =
  | { kind: "tui"; directory?: string; client: string[] }
  | { kind: "run"; client: string[] }
  | { kind: "serve"; hostname: string; port: number }
  | { kind: "attach"; url: string; client: string[] }
  | { kind: "trust"; action: "status" | "yes" | "no"; directory?: string }
  | { kind: "modes"; json: boolean }
  | { kind: "audit"; from?: string; to?: string; user?: string; format: "md" | "json" }
  | { kind: "usage"; from?: string; to?: string; team?: string; format: "md" | "json" }
  | { kind: "dossier"; action: "list" | "seal"; session?: string; task?: number | "last"; out?: string; format: "md" | "json"; diff: boolean; test?: string }
  | { kind: "dossier"; action: "verify"; file: string; key?: string }
  | { kind: "compare"; models: string[]; mode: string; task: string; test?: string; out?: string }
  | { kind: "registry"; action: "pack"; source: string; version: string; description?: string; out?: string }
  | { kind: "registry"; action: "install"; target: string; from?: string; project: boolean; force: boolean }
  | { kind: "registry"; action: "verify" | "trust" | "untrust"; target: string }
  | { kind: "registry"; action: "list"; from?: string }
  | { kind: "registry"; action: "key" }
  | { kind: "tips"; paths: string[]; format: "text" | "json"; failOn?: "warning" | "info"; since?: string }
  | { kind: "diagram"; source: "code" | "cobol"; program?: string; depth?: number; directory?: string }
  | { kind: "help" }
  | { kind: "version" }

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UsageError"
  }
}

export const HELP = `Bobi – on-prem AI development partner

Usage:
  bobi [directory]                 Start the interactive terminal UI
  bobi run [options] <message...>  Run one task headless and print the result
  bobi serve [--hostname H] [--port P]
                                   Start the Bobi server (for the IDE or a container)
  bobi attach <url> [run options] [run <message...>]
                                   Use a running Bobi server, e.g. in the sandbox
                                   (password from BOBI_SERVER_PASSWORD)
  bobi trust [--status|--yes|--no] [directory]
                                   Show or set project trust (JSON output with --status)
  bobi --version | --help

  --trust                          Trust the project's AGENTS.md, rules, modes and .bobi/config.jsonc

  bobi modes [--json]              List the modes available in this project
  bobi audit [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--user U] [--format md|json]
                                   Audit and compliance report from the local audit log
  bobi usage [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--team T] [--format md|json]
                                   Usage per person, team, mode and day (tokens, tasks, approved changes)
  bobi dossier [--list] [--session ID] [--task N|last] [--out FILE.json] [--format md|json] [--diff] [--test "<command>"]
                                   Signed change dossier of a session (default: the latest) or of one task (prompt) of
                                   it; --list shows the sessions, or the tasks of --session; --diff adds the project's
                                   uncommitted changes, --test runs a command and adds its result
  bobi dossier verify <FILE.json> [--key public.pem]
                                   Check a dossier: chain, signature and (with --key) who signed it
  bobi compare --models <a,b[,c]> [--mode <slug>] [--test "<command>"] [--out FILE.json] <task...>
                                   Same task with several models, each in its own git worktree of HEAD (edits are
                                   approved automatically there, nothing else); then the test command on each result
  bobi registry pack <skill-dir|command.md> --version 1.0.0 [--description T] [--out DIR]
                                   Pack and sign a skill or slash command with your publisher key
  bobi registry key|trust <public-key.pem>|untrust <key-id>
                                   Show your public key; trust or distrust a publisher
  bobi registry list [--from DIR]  Installed packages, or the packages in a registry folder
  bobi registry install <name|file.bobipkg.json> [--from DIR] [--project] [--force]
                                   Install a package from a trusted publisher (signature and files are checked)
  bobi registry verify <file>      Check a package without installing it
  bobi tips [--format text|json] [--fail-on warning|info] [--since <git-ref>] [paths...]
                                   Code tips: complex functions and anti-patterns (TS/JS, COBOL), no model call
  bobi diagram [code|cobol] [--program P] [--depth N] [directory]
                                   Architecture diagram (Mermaid) from the code graph or the COBOL index

Run options:
  --mode <slug>        Mode to use (code, plan, ask, advanced, orchestrator, security, own modes)
  --model, -m <id>     Model id served by the configured endpoint
  --format json        Machine-readable output
  --continue, -c       Continue the last session
  --session, -s <id>   Continue a session
  --file, -f <path>    Attach a file

Configuration: ~/.bobi/config.jsonc, <project>/.bobi/config.jsonc, BOBI_* environment variables.`

// Flags forwarded to the engine's `run` client. Anything else is refused, so no engine flag can
// bypass Bobi (e.g. --auto, --server).
const RUN_FLAGS_WITH_VALUE = new Set(["--model", "-m", "--agent", "--mode", "--format", "--session", "-s", "--file", "-f", "--title"])
const RUN_FLAGS = new Set(["--continue", "-c", "--thinking"])

function intFlag(value: string | undefined, name: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0 || n > 65_535) throw new UsageError(`${name} needs a port number`)
  return n
}

/** `--task` takes a task number (1, 2, …) or `last`. */
function taskNumber(value: string): number | "last" {
  if (value === "last") return value
  if (!/^[1-9]\d{0,5}$/.test(value)) throw new UsageError("--task is a task number like 2, or last")
  return Number(value)
}

export function parseArgs(argv: readonly string[]): Command {
  const [first, ...rest] = argv
  if (first === undefined) return { kind: "tui", client: [] }
  if (first === "--help" || first === "-h" || first === "help") return { kind: "help" }
  if (first === "--version" || first === "-v") return { kind: "version" }

  if (first === "serve") {
    let hostname = "127.0.0.1"
    let port = 0
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]
      if (arg === "--hostname") hostname = rest[++i] ?? ""
      else if (arg === "--port") port = intFlag(rest[++i], "--port")
      else throw new UsageError(`unknown option for serve: ${arg}`)
    }
    if (!hostname) throw new UsageError("--hostname needs a value")
    return { kind: "serve", hostname, port }
  }

  if (first === "modes") {
    const unknown = rest.find((a) => a !== "--json")
    if (unknown) throw new UsageError(`unknown option for modes: ${unknown}`)
    return { kind: "modes", json: rest.includes("--json") }
  }

  if (first === "audit" || first === "usage") {
    // Same options; audit filters by --user, usage by --team.
    const filter = first === "audit" ? "--user" : "--team"
    const out: { from?: string; to?: string; user?: string; team?: string; format: "md" | "json" } = { format: "md" }
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]!
      const value = rest[i + 1]
      if (["--from", "--to", filter, "--format"].includes(arg) && value === undefined) throw new UsageError(`${arg} needs a value`)
      if (arg === "--from" || arg === "--to") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value!)) throw new UsageError(`${arg} needs a date like 2026-10-01`)
        out[arg === "--from" ? "from" : "to"] = value!
        i++
      } else if (arg === filter) (out[first === "audit" ? "user" : "team"] = value!), i++
      else if (arg === "--format") {
        if (value !== "md" && value !== "json") throw new UsageError("--format is md or json")
        out.format = value
        i++
      } else if (arg !== "report") throw new UsageError(`unknown option for ${first}: ${arg}`)
    }
    return { kind: first, ...out } as Command
  }

  if (first === "dossier") {
    if (rest[0] === "verify") {
      const out: Extract<Command, { kind: "dossier"; action: "verify" }> = { kind: "dossier", action: "verify", file: "" }
      for (let i = 1; i < rest.length; i++) {
        const arg = rest[i]!
        if (arg === "--key") {
          const value = rest[++i]
          if (!value) throw new UsageError("--key needs a file")
          out.key = value
        } else if (arg.startsWith("-")) throw new UsageError(`unknown option for dossier verify: ${arg}`)
        else if (!out.file) out.file = arg
        else throw new UsageError("dossier verify takes one file")
      }
      if (!out.file) throw new UsageError("dossier verify needs a dossier file")
      return out
    }
    const out: Extract<Command, { kind: "dossier"; action: "list" | "seal" }> = { kind: "dossier", action: "seal", format: "md", diff: false }
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]!
      const value = rest[i + 1]
      if (["--session", "--task", "--out", "--format", "--test"].includes(arg) && !value) throw new UsageError(`${arg} needs a value`)
      if (arg === "--list") out.action = "list"
      else if (arg === "--diff") out.diff = true
      else if (arg === "--session") (out.session = value!), i++
      else if (arg === "--task") (out.task = taskNumber(value!)), i++
      else if (arg === "--out") (out.out = value!), i++
      else if (arg === "--test") (out.test = value!), i++
      else if (arg === "--format") {
        if (value !== "md" && value !== "json") throw new UsageError("--format is md or json")
        out.format = value
        i++
      } else throw new UsageError(`unknown option for dossier: ${arg}`)
    }
    return out
  }

  if (first === "compare") {
    const out: Extract<Command, { kind: "compare" }> = { kind: "compare", models: [], mode: "code", task: "" }
    const words: string[] = []
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]!
      const value = rest[i + 1]
      if (["--models", "--mode", "--test", "--out"].includes(arg) && !value) throw new UsageError(`${arg} needs a value`)
      if (arg === "--models") {
        out.models = [...new Set(value!.split(",").map((m) => m.trim()).filter(Boolean))]
        i++
      } else if (arg === "--mode") (out.mode = value!), i++
      else if (arg === "--test") (out.test = value!), i++
      else if (arg === "--out") (out.out = value!), i++
      else if (arg.startsWith("-")) throw new UsageError(`unknown option for compare: ${arg}`)
      else words.push(arg)
    }
    out.task = words.join(" ").trim()
    if (out.models.length < 2 || out.models.length > 4) throw new UsageError("compare needs 2 to 4 models: --models a,b")
    if (!out.task) throw new UsageError("compare needs a task")
    return out
  }

  if (first === "registry") {
    const [sub, ...args] = rest
    const take = (list: string[], flags: string[]) => {
      const values: Record<string, string> = {}
      const switches = new Set<string>()
      const words: string[] = []
      for (let i = 0; i < list.length; i++) {
        const arg = list[i]!
        if (flags.includes(arg)) {
          if (!list[i + 1]) throw new UsageError(`${arg} needs a value`)
          values[arg] = list[++i]!
        } else if (arg === "--project" || arg === "--force") switches.add(arg)
        else if (arg.startsWith("-")) throw new UsageError(`unknown option for registry ${sub}: ${arg}`)
        else words.push(arg)
      }
      return { values, switches, words }
    }
    const one = (words: string[], what: string) => {
      if (words.length !== 1) throw new UsageError(`registry ${sub} needs ${what}`)
      return words[0]!
    }
    if (sub === "pack") {
      const { values, words } = take(args, ["--version", "--description", "--out"])
      if (!values["--version"]) throw new UsageError("registry pack needs --version 1.0.0")
      return { kind: "registry", action: "pack", source: one(words, "a skill directory or command file"), version: values["--version"], description: values["--description"], out: values["--out"] }
    }
    if (sub === "install") {
      const { values, switches, words } = take(args, ["--from"])
      return { kind: "registry", action: "install", target: one(words, "a package name or file"), from: values["--from"], project: switches.has("--project"), force: switches.has("--force") }
    }
    if (sub === "verify" || sub === "trust" || sub === "untrust") return { kind: "registry", action: sub, target: one(take(args, []).words, sub === "untrust" ? "a key id" : "a file") }
    if (sub === "list") return { kind: "registry", action: "list", from: take(args, ["--from"]).values["--from"] }
    if (sub === "key") return { kind: "registry", action: "key" }
    throw new UsageError("registry commands: pack, install, list, verify, key, trust, untrust")
  }

  if (first === "tips") {
    const out: Extract<Command, { kind: "tips" }> = { kind: "tips", paths: [], format: "text" }
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]!
      if (arg === "--format") {
        const value = rest[++i]
        if (value !== "text" && value !== "json") throw new UsageError("--format is text or json")
        out.format = value
      } else if (arg === "--fail-on") {
        const value = rest[++i]
        if (value !== "warning" && value !== "info") throw new UsageError("--fail-on is warning or info")
        out.failOn = value
      } else if (arg === "--since") {
        const value = rest[++i]
        if (!value || value.startsWith("-")) throw new UsageError("--since needs a git ref, e.g. origin/main")
        out.since = value
      } else if (arg.startsWith("-")) throw new UsageError(`unknown option for tips: ${arg}`)
      else out.paths.push(arg)
    }
    return out
  }

  if (first === "diagram") {
    const out: Extract<Command, { kind: "diagram" }> = { kind: "diagram", source: "code" }
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]!
      if (arg === "code" || arg === "cobol") out.source = arg
      else if (arg === "--program") {
        const value = rest[++i]
        if (!value) throw new UsageError("--program needs a value")
        out.program = value
      } else if (arg === "--depth") {
        const value = Number(rest[++i])
        if (!Number.isInteger(value) || value < 1 || value > 4) throw new UsageError("--depth needs a number between 1 and 4")
        out.depth = value
      } else if (arg.startsWith("-")) throw new UsageError(`unknown option for diagram: ${arg}`)
      else if (out.directory) throw new UsageError("diagram takes one directory")
      else out.directory = arg
    }
    if (out.program && out.source !== "cobol") throw new UsageError("--program is only for cobol diagrams")
    return out
  }

  if (first === "trust") {
    let action: "status" | "yes" | "no" = "status"
    let directory: string | undefined
    for (const arg of rest) {
      if (arg === "--status" || arg === "--yes" || arg === "--no") action = arg.slice(2) as typeof action
      else if (arg.startsWith("-")) throw new UsageError(`unknown option for trust: ${arg}`)
      else if (directory) throw new UsageError("trust takes one directory")
      else directory = arg
    }
    return { kind: "trust", action, ...(directory ? { directory } : {}) }
  }

  if (first === "attach") {
    const [url, ...more] = rest
    if (!url || !/^https?:\/\/[^\s]+$/.test(url)) throw new UsageError("attach needs the server URL, e.g. http://127.0.0.1:4096")
    if (more.length === 0) return { kind: "attach", url, client: [] }
    const inner = parseArgs(more)
    if (inner.kind !== "run") throw new UsageError("attach accepts only a run command after the URL")
    return { kind: "attach", url, client: ["run", ...inner.client] }
  }

  if (first === "run") {
    const client: string[] = []
    for (let i = 0; i < rest.length; i++) {
      const arg = rest[i]!
      if (RUN_FLAGS_WITH_VALUE.has(arg)) {
        const value = rest[++i]
        if (value === undefined) throw new UsageError(`${arg} needs a value`)
        // Bobi calls them modes; the engine client calls them agents.
        client.push(arg === "--mode" ? "--agent" : arg, value)
      } else if (RUN_FLAGS.has(arg)) client.push(arg)
      else if (arg.startsWith("-")) throw new UsageError(`unknown option for run: ${arg}`)
      else client.push(arg)
    }
    if (!client.some((a, i) => !a.startsWith("-") && !RUN_FLAGS_WITH_VALUE.has(client[i - 1] ?? ""))) {
      throw new UsageError("run needs a message")
    }
    return { kind: "run", client }
  }

  if (first.startsWith("-") || rest.length > 0) throw new UsageError(`unknown command: ${argv.join(" ")}\n\n${HELP}`)
  return { kind: "tui", directory: first, client: [] }
}
