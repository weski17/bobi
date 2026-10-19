// The engine's terminal client (TUI or `run`), started as a child process connected to the Bobi server.
import path from "node:path"
import type { BobiPaths } from "@bobi/server"

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..")
export const ENGINE_CLI = path.join(REPO_ROOT, "vendor", "opencode", "packages", "cli", "src", "index.ts")

/** The engine CLI needs its JSX runtime preloaded (vendor/opencode/packages/cli/bunfig.toml). */
export function preloadPath(): string {
  return Bun.resolveSync("@opentui/solid/preload", path.dirname(ENGINE_CLI))
}

export type ClientSpec = { readonly argv: string[]; readonly env: Record<string, string> }

export function clientSpec(
  args: readonly string[],
  server: { url: string; password: string },
  paths: BobiPaths,
  baseEnv: Record<string, string | undefined> = process.env,
): ClientSpec {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(baseEnv)) if (v !== undefined) env[k] = v
  // The client process only renders; tools run in the server. Its own state goes under ~/.bobi/tui.
  const tui = path.join(paths.home, "tui")
  Object.assign(env, {
    OPENCODE_PASSWORD: server.password,
    OPENCODE_CLIENT: "bobi",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    XDG_CONFIG_HOME: path.join(tui, "config"),
    XDG_DATA_HOME: path.join(tui, "data"),
    XDG_STATE_HOME: path.join(tui, "state"),
    XDG_CACHE_HOME: path.join(tui, "cache"),
  })
  return { argv: [process.execPath, "--preload", preloadPath(), ENGINE_CLI, ...args, "--server", server.url], env }
}
