// The `bobi` application: owns the server (engine + @bobi/core) and starts the terminal client.
import { randomBytes } from "node:crypto"
import { mkdirSync, realpathSync, statSync } from "node:fs"
import path from "node:path"
import { findProjectRoot, loadConfig, TrustStore, trustFiles, type LoadedConfig } from "@bobi/config"
import { auditReport, readAuditLog, renderAuditReport } from "@bobi/core"
import { CobolProject, paragraphDiagram, systemDiagram } from "@bobi/mcp-cobol"
import { CodeGraph, dependencyDiagram } from "@bobi/mcp-code-graph"
import { bobiPaths, ensureCheckpointRepo, startBobiServer, type BobiPaths, type BobiServer } from "@bobi/server"
import { loadModes, mcpServers, type Mode } from "@bobi/modes"
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
  const server = await startBobiServer({ config: loaded.config, paths, password: secret, secrets: [loaded.apiKey, secret], env: io.env, directory: cwd, ...listen })
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
    if (started.loaded.config.a2a.enabled) io.err(`bobi: A2A enabled – agent card at ${started.server.url}/.well-known/agent-card.json (tasks are read-only)`)
    if (!password) io.err(`bobi: generated server password (user "opencode"): ${started.password}`)
    await io.untilStopped()
    await stop(started)
    return 0
  }

  if (command.kind === "modes") {
    const project = findProjectRoot(io.cwd)
    const paths = bobiPaths(io.env)
    const modes = loadModes({ globalDir: paths.home, project, includeProject: new TrustStore(paths.home).isTrusted(project) })
    const groups = (m: Mode) => m.groups.map((g) => (Array.isArray(g) ? (g[0] === "edit" ? `edit(${g[1].fileRegex})` : `mcp(${mcpServers(m)})`) : g)).join(", ")
    if (command.json) io.out(JSON.stringify(modes.map((m) => ({ slug: m.slug, name: m.name, description: m.description, groups: m.groups, source: m.source }))))
    else for (const m of modes) io.out(`${m.slug.padEnd(14)} ${m.name.padEnd(14)} ${groups(m)}`)
    return 0
  }

  if (command.kind === "audit") {
    const dir = path.join(bobiPaths(io.env).home, "audit")
    const { records, skipped } = readAuditLog(dir, command)
    const report = auditReport(records, { ...command, skipped })
    if (records.length === 0) io.err(`bobi: no audit records in ${dir} for this period`)
    io.out(command.format === "json" ? JSON.stringify(report, null, 2) : renderAuditReport(report))
    return 0
  }

  if (command.kind === "diagram") {
    // An explicit directory is used as given; otherwise the project around the working directory.
    const root = command.directory ? path.resolve(io.cwd, command.directory) : findProjectRoot(io.cwd)
    if (command.source === "code") {
      io.out(dependencyDiagram(CodeGraph.build(root), command.depth ? { depth: command.depth } : {}))
      return 0
    }
    const project = CobolProject.build(root)
    if (!command.program) {
      io.out(systemDiagram(project))
      return 0
    }
    const program = project.programs.get(command.program.toUpperCase())
    if (!program) throw new UsageError(`no COBOL program ${command.program} in ${root}`)
    io.out(paragraphDiagram(program))
    return 0
  }

  if (command.kind === "trust") {
    const directory = realpathSync(path.resolve(io.cwd, command.directory ?? "."))
    const store = new TrustStore(bobiPaths(io.env).home)
    if (command.action !== "status") store.decide(directory, command.action === "yes")
    const files = trustFiles(findProjectRoot(directory)).map((f) => path.relative(findProjectRoot(directory), f))
    io.out(JSON.stringify({ project: findProjectRoot(directory), status: store.status(directory), files }))
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
