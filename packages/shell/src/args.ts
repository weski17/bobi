// Command line of the `bobi` application (ADR-0013). Only Bobi's own commands exist.

export const VERSION = "0.1.0"

export type Command =
  | { kind: "tui"; directory?: string; client: string[] }
  | { kind: "run"; client: string[] }
  | { kind: "serve"; hostname: string; port: number }
  | { kind: "attach"; url: string; client: string[] }
  | { kind: "trust"; action: "status" | "yes" | "no"; directory?: string }
  | { kind: "modes"; json: boolean }
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
