// The `bobi` application: owns the server (engine + @bobi/core) and starts the terminal client.
import { randomBytes } from "node:crypto"
import { mkdirSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import { loadConfig, TrustStore, trustFiles, type LoadedConfig } from "@bobi/config"
import { bobiPaths, ensureCheckpointRepo, startBobiServer, type BobiPaths, type BobiServer } from "@bobi/server"
import { HELP, parseArgs, UsageError, VERSION, type Command } from "./args.ts"
import { clientSpec } from "./client.ts"

export type Io = {
  readonly cwd: string
  readonly env: Record<string, string | undefined>
  readonly out: (line: string) => void
  readonly err: (line: string) => void
  /** Starts the terminal client and resolves with its exit code. */
  readonly spawn: (argv: string[], env: Record<string, string>, cwd: string) => Promise<number>
  /** Resolves when the server should stop (signal); only used by `serve`. */
  readonly untilStopped: () => Promise<void>
  /** Asks the user a yes/no question; undefined when there is no interactive terminal. */
  readonly ask?: (question: string) => Promise<boolean>
}

export type Started = { server: BobiServer; password: string; paths: BobiPaths; loaded: LoadedConfig }

export async function startServer(io: Io, cwd: string, listen: { hostname: string; port: number }, password?: string): Promise<Started> {
  const paths = bobiPaths(io.env)
  const loaded = loadConfig({ cwd, env: io.env, trustedProject: new TrustStore(paths.home).isTrusted(cwd) })
  mkdirSync(paths.config, { recursive: true })
  const secret = password ?? randomBytes(24).toString("base64url")
  if (secret.length < 16) throw new Error("server password must have at least 16 characters")
  const server = await startBobiServer({ config: loaded.config, paths, password: secret, secrets: [loaded.apiKey, secret], env: io.env, ...listen })
  return { server, password: secret, paths, loaded }
}

/**
 * Project trust (asked once per project and whenever its Bobi files change). Without trust, the project's
 * AGENTS.md, rules, custom modes and config – including auto-approvals – are ignored.
 */
export async function resolveTrust(io: Io, project: string, paths: BobiPaths, trustFlag: boolean): Promise<boolean> {
  const store = new TrustStore(paths.home)
  const status = store.status(project)
  if (status === "none" || status === "trusted") return true
  if (trustFlag) {
    store.decide(project, true)
    return true
  }
  if (status === "unknown" && io.ask) {
    const files = trustFiles(project).map((f) => `  ${path.relative(project, f)}`)
    const yes = await io.ask(
      `This project contains files that instruct or configure Bobi:\n${files.join("\n")}\n` +
        "Trust this project? Its rules, modes and settings (including auto-approvals) are used only if you trust it. [y/N] ",
    )
    store.decide(project, yes)
    if (yes) return true
  }
  io.err("bobi: project not trusted – its AGENTS.md, rules, modes and .bobi/config.jsonc are ignored (use --trust to trust it)")
  return false
}

function projectRoot(repo: ReturnType<typeof ensureCheckpointRepo>, directory: string): string {
  return repo.kind === "git" ? repo.root : directory
}

function announce(io: Io, repo: ReturnType<typeof ensureCheckpointRepo>) {
  if (repo.kind === "shadow" && repo.created) {
    io.err(`bobi: no git repository here – created a hidden checkpoint repository (${repo.gitDir}) so changes can be undone`)
  }
}

async function stop(started: Started) {
  await started.server.stop()
}

export async function runApp(rawArgv: readonly string[], io: Io): Promise<number> {
  const trustFlag = rawArgv.includes("--trust")
  const argv = rawArgv.filter((a) => a !== "--trust")
  const command: Command = parseArgs(argv)
  if (command.kind === "help") return io.out(HELP), 0
  if (command.kind === "version") return io.out(`bobi ${VERSION}`), 0

  if (command.kind === "serve") {
    const password = io.env.BOBI_SERVER_PASSWORD
    if (!password && command.hostname !== "127.0.0.1" && command.hostname !== "localhost") {
      io.err("bobi: BOBI_SERVER_PASSWORD is required when listening on a non-loopback address")
      return 2
    }
    const started = await startServer(io, io.cwd, command, password)
    io.out(JSON.stringify({ url: started.server.url }))
    if (!password) io.err(`bobi: generated server password (user "opencode"): ${started.password}`)
    await io.untilStopped()
    await stop(started)
    return 0
  }

  if (command.kind === "attach") {
    const password = io.env.BOBI_SERVER_PASSWORD
    if (!password) {
      io.err("bobi: attach needs BOBI_SERVER_PASSWORD")
      return 2
    }
    const health = await fetch(`${command.url}/api/session`, { headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` } }).catch(() => undefined)
    if (!health || health.status !== 200) {
      io.err(`bobi: cannot reach a Bobi server at ${command.url} (${health ? `HTTP ${health.status}` : "no connection"})`)
      return 2
    }
    const paths = bobiPaths(io.env)
    const repo = ensureCheckpointRepo(io.cwd, paths)
    announce(io, repo)
    await resolveTrust(io, projectRoot(repo, realpathSync(io.cwd)), paths, trustFlag)
    const spec = clientSpec(command.client, { url: command.url, password }, paths, io.cwd, io.env)
    return io.spawn(spec.argv, spec.env, io.cwd)
  }

  const directory = command.kind === "tui" && command.directory ? path.resolve(io.cwd, command.directory) : io.cwd
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new UsageError(`not a command or directory: ${command.kind === "tui" ? command.directory : directory}\n\n${HELP}`)
  }
  const paths = bobiPaths(io.env)
  const repo = ensureCheckpointRepo(directory, paths)
  announce(io, repo)
  await resolveTrust(io, projectRoot(repo, realpathSync(directory)), paths, trustFlag)
  const started = await startServer(io, directory, { hostname: "127.0.0.1", port: 0 })
  try {
    const args = command.kind === "run" ? ["run", ...command.client] : []
    const spec = clientSpec(args, { url: started.server.url, password: started.password }, started.paths, directory, io.env)
    return await io.spawn(spec.argv, spec.env, directory)
  } finally {
    await stop(started)
  }
}
