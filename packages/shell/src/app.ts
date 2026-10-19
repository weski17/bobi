// The `bobi` application: owns the server (engine + @bobi/core) and starts the terminal client.
import { randomBytes } from "node:crypto"
import { mkdirSync, statSync } from "node:fs"
import path from "node:path"
import { loadConfig, type LoadedConfig } from "@bobi/config"
import { bobiPaths, createHost, serve, type BobiPaths, type Host, type RunningServer } from "@bobi/server"
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
}

export type Started = { host: Host; server: RunningServer; password: string; paths: BobiPaths; loaded: LoadedConfig }

export async function startServer(io: Io, cwd: string, listen: { hostname: string; port: number }, password?: string): Promise<Started> {
  const loaded = loadConfig({ cwd, env: io.env })
  const paths = bobiPaths(io.env)
  mkdirSync(paths.config, { recursive: true })
  const secret = password ?? randomBytes(24).toString("base64url")
  const host = await createHost({ config: loaded.config, paths, secrets: [loaded.apiKey, secret] })
  try {
    const server = serve({ host, password: secret, ...listen })
    return { host, server, password: secret, paths, loaded }
  } catch (error) {
    await host.close()
    throw error
  }
}

async function stop(started: Started) {
  await started.server.stop()
  await started.host.close()
}

export async function runApp(argv: readonly string[], io: Io): Promise<number> {
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
    const spec = clientSpec(command.client, { url: command.url, password }, bobiPaths(io.env), io.env)
    return io.spawn(spec.argv, spec.env, io.cwd)
  }

  const directory = command.kind === "tui" && command.directory ? path.resolve(io.cwd, command.directory) : io.cwd
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new UsageError(`not a command or directory: ${command.kind === "tui" ? command.directory : directory}\n\n${HELP}`)
  }
  const started = await startServer(io, directory, { hostname: "127.0.0.1", port: 0 })
  try {
    const args = command.kind === "run" ? ["run", ...command.client] : []
    const spec = clientSpec(args, { url: started.server.url, password: started.password }, started.paths, io.env)
    return await io.spawn(spec.argv, spec.env, directory)
  } finally {
    await stop(started)
  }
}
