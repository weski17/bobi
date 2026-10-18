// Builds the command line and environment for running the OpenCode CLI as Bobi.
// Phase 1 launcher; the full Bobi Shell follows in Phase 5 (ADR-0009).
import os from "node:os"
import path from "node:path"
import { OFFLINE_ENV, toOpenCodeConfig, toOpenCodeEnv, type BobiConfig } from "@bobi/config"
import { OpenCode } from "@opencode/client"

export const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..")
export const OPENCODE_CLI = path.join(REPO_ROOT, "vendor", "opencode", "packages", "cli", "src", "index.ts")
/** OpenCode requires a directory for configured plugin paths (it resolves `index` inside). */
export const CORE_ENTRY = path.join(REPO_ROOT, "packages", "core", "plugin")
export const CORE_PLUGIN_ID = "bobi.core"
const CLI_DIR = path.dirname(OPENCODE_CLI)

/** The OpenCode CLI needs its JSX runtime preloaded (vendor/opencode/packages/cli/bunfig.toml). */
export function preloadPath(): string {
  return Bun.resolveSync("@opentui/solid/preload", CLI_DIR)
}

/** Subcommands that would contact vendor services or bypass Bobi's configuration. */
export const BLOCKED_COMMANDS = new Set(["upgrade", "update", "uninstall", "auth", "pair", "service", "stats"])
/** Flags that would bypass approvals (ADR-0005). */
export const BLOCKED_FLAGS = new Set(["--auto"])
/** Commands that start a session and must use a private server, not a shared background service. */
const SESSION_COMMANDS = new Set(["run", "mini"])

export class LaunchError extends Error {
  override name = "LaunchError"
}

export type Launch = {
  readonly argv: string[]
  readonly env: Record<string, string>
  /** True when the command starts a session and needs a Bobi-managed server. */
  readonly session: boolean
}

export function buildLaunch(config: BobiConfig, args: readonly string[], baseEnv: Record<string, string | undefined> = process.env): Launch {
  const command = args.find((a) => !a.startsWith("-"))
  if (command && BLOCKED_COMMANDS.has(command)) throw new LaunchError(`"${command}" is not available in Bobi.`)
  const blocked = args.find((a) => BLOCKED_FLAGS.has(a))
  if (blocked) throw new LaunchError(`${blocked} is not available in Bobi. Configure auto-approvals in .bobi/config.jsonc instead.`)

  const isSession = command === undefined || SESSION_COMMANDS.has(command) || (command !== undefined && !isSubcommand(command))
  const argv = [process.execPath, "--preload", preloadPath(), OPENCODE_CLI, ...args]

  const opencodeConfig = toOpenCodeConfig(config, { plugins: [{ package: CORE_ENTRY }] })
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(baseEnv)) if (v !== undefined) env[k] = v
  Object.assign(env, OFFLINE_ENV, toOpenCodeEnv(config), {
    OPENCODE_CONFIG_CONTENT: JSON.stringify(opencodeConfig),
    // Isolate from any personal OpenCode configuration on the machine.
    OPENCODE_CONFIG_DIR: baseEnv.BOBI_OPENCODE_CONFIG_DIR ?? path.join(os.homedir(), ".bobi", "opencode"),
    OPENCODE_CLIENT: "bobi",
  })
  return { argv, env, session: isSession && !args.includes("--server") }
}

export type Server = { readonly url: string; readonly password: string; stop(): Promise<void> }

/**
 * Starts a private OpenCode server for one Bobi invocation. The server exits when its stdin
 * closes (OpenCode's ownership lease), so it never outlives the `bobi` process.
 */
export async function startServer(launch: Launch, cwd: string): Promise<Server> {
  const password = crypto.randomUUID() + crypto.randomUUID()
  const child = Bun.spawn([process.execPath, "--preload", preloadPath(), OPENCODE_CLI, "serve", "--stdio", "--hostname", "127.0.0.1", "--port", "0"], {
    cwd,
    env: { ...launch.env, OPENCODE_PASSWORD: password },
    stdin: "pipe",
    stdout: "pipe",
    stderr: launch.env.OPENCODE_PRINT_LOGS === "1" ? "inherit" : "ignore",
  })
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (!buffer.includes("\n")) {
    const { value, done } = await reader.read()
    if (done) throw new LaunchError("Bobi server exited before it was ready. Run with --print-logs for details.")
    buffer += decoder.decode(value)
  }
  const ready = JSON.parse(buffer.slice(0, buffer.indexOf("\n"))) as { url?: string }
  if (!ready.url) throw new LaunchError(`Unexpected server readiness line: ${buffer}`)
  // Keep draining stdout so later server writes cannot block.
  void (async () => {
    while (!(await reader.read()).done) {}
  })()
  return {
    url: ready.url,
    password,
    async stop() {
      child.stdin.end()
      const timer = setTimeout(() => child.kill("SIGTERM"), 3_000)
      await child.exited
      clearTimeout(timer)
    },
  }
}

const KNOWN_SUBCOMMANDS = new Set(["acp", "api", "debug", "mcp", "plugin", "models", "mini", "run", "session", "reload", "serve", "upgrade", "update", "uninstall", "auth", "pair", "service", "stats"])
// A bare word that is not a subcommand is the project directory argument of the TUI.
const isSubcommand = (word: string) => KNOWN_SUBCOMMANDS.has(word)

/**
 * Fail closed: OpenCode only logs a warning when a configured plugin cannot be loaded and then
 * runs with its allow-all defaults. Bobi refuses to start a session unless bobi.core is active.
 */
export async function verifyCore(server: Pick<Server, "url" | "password">, directory: string, timeoutMs = 15_000): Promise<void> {
  const auth = `Basic ${btoa(`opencode:${server.password}`)}`
  const client = OpenCode.make({
    baseUrl: server.url,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), authorization: auth } })) as typeof fetch,
  })
  // Plugins activate asynchronously after the location boots; wait until the generation is loaded.
  const deadline = Date.now() + timeoutMs
  let plugins = await client.plugin.list({ location: { directory } })
  while (plugins.data.length === 0 && Date.now() < deadline) {
    await Bun.sleep(100)
    plugins = await client.plugin.list({ location: { directory } })
  }
  const core = plugins.data.find((p) => p.id === CORE_PLUGIN_ID)
  if (!core) throw new LaunchError(`${CORE_PLUGIN_ID} was not loaded; refusing to start without Bobi's safeguards.`)
  if (core.state.status !== "active") throw new LaunchError(`${CORE_PLUGIN_ID} failed to start: ${core.state.error}`)
}
