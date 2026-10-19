// Loads Bobi config from (lowest to highest precedence):
//   built-in defaults → $BOBI_HOME/config.jsonc (default ~/.bobi) → <project>/.bobi/config.jsonc (if trusted)
//   → $BOBI_CONFIG → environment
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { ConfigError, DEFAULTS, validatePartial, type AutoApproveRule, type BobiConfig, type DeepPartial } from "./schema.ts"

export type LoadOptions = {
  readonly cwd: string
  /** The user's home directory (default os.homedir()); global config lives in $BOBI_HOME or <home>/.bobi. */
  readonly home?: string
  readonly env?: Record<string, string | undefined>
  /** Whether the project's own .bobi/config.jsonc may be used (project trust). Default true. */
  readonly trustedProject?: boolean
}

export type LoadedConfig = {
  readonly config: BobiConfig
  /** Files that contributed, in precedence order. */
  readonly sources: readonly string[]
  /** API key resolved from the environment; never written to disk or logs. */
  readonly apiKey: string | undefined
}

function readJsonc(file: string): unknown {
  try {
    return Bun.JSONC.parse(readFileSync(file, "utf8"))
  } catch (error) {
    throw new ConfigError(file, [`cannot parse JSONC: ${(error as Error).message}`])
  }
}

function merge(base: BobiConfig, patch: DeepPartial<BobiConfig>): BobiConfig {
  return {
    model: { ...base.model, ...patch.model, models: patch.model?.models ?? base.model.models },
    modes: { ...base.modes, ...(patch.modes as BobiConfig["modes"] | undefined) },
    // Auto-approvals accumulate so a project can add rules but every rule stays visible in review.
    autoApprove: [
      ...base.autoApprove,
      ...((patch.autoApprove ?? []) as Partial<AutoApproveRule>[]).map((r) => ({ action: r.action!, resource: r.resource!, modes: r.modes ?? [] })),
    ],
    telemetry: { ...base.telemetry, ...patch.telemetry },
    checkpoints: { ...base.checkpoints, ...patch.checkpoints },
    // Servers merge by name; a later file replaces a server with the same name entirely.
    mcp: {
      servers: { ...base.mcp.servers, ...((patch.mcp?.servers ?? {}) as BobiConfig["mcp"]["servers"]) },
      ...(patch.mcp?.timeout || base.mcp.timeout ? { timeout: { ...base.mcp.timeout, ...patch.mcp?.timeout } } : {}),
    },
    autocomplete: { ...base.autocomplete, ...patch.autocomplete },
  }
}

/** Finds the nearest directory containing `.bobi/` or `.git`, walking up from cwd. */
export function findProjectRoot(cwd: string): string {
  let dir = path.resolve(cwd)
  while (true) {
    if (existsSync(path.join(dir, ".bobi")) || existsSync(path.join(dir, ".git"))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(cwd)
    dir = parent
  }
}

export function loadConfig(options: LoadOptions): LoadedConfig {
  const env = options.env ?? process.env
  const home = options.home ?? os.homedir()
  const globalDir = env.BOBI_HOME ?? path.join(home, ".bobi")
  const project = findProjectRoot(options.cwd)
  const candidates = [
    path.join(globalDir, "config.jsonc"),
    ...(options.trustedProject === false ? [] : [path.join(project, ".bobi", "config.jsonc")]),
    ...(env.BOBI_CONFIG ? [path.resolve(options.cwd, env.BOBI_CONFIG)] : []),
  ]

  let config = structuredClone(DEFAULTS)
  const sources: string[] = []
  for (const file of [...new Set(candidates)]) {
    if (!existsSync(file)) {
      if (env.BOBI_CONFIG && file === path.resolve(options.cwd, env.BOBI_CONFIG)) throw new ConfigError(file, ["BOBI_CONFIG points to a missing file"])
      continue
    }
    config = merge(config, validatePartial(readJsonc(file), file))
    sources.push(file)
  }

  const fromEnv: DeepPartial<BobiConfig> = {
    model: {
      ...(env.BOBI_MODEL_BASE_URL ? { baseURL: env.BOBI_MODEL_BASE_URL } : {}),
      ...(env.BOBI_MODEL_PROTOCOL ? { protocol: env.BOBI_MODEL_PROTOCOL as BobiConfig["model"]["protocol"] } : {}),
      ...(env.BOBI_MODEL ? { default: env.BOBI_MODEL } : {}),
    },
    telemetry: {
      ...(env.OTEL_EXPORTER_OTLP_ENDPOINT ? { otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT } : {}),
      ...(env.BOBI_USER ? { user: env.BOBI_USER } : {}),
    },
  }
  config = merge(config, validatePartial(fromEnv, "environment"))
  if (!config.telemetry.user) config.telemetry.user = env.USER ?? env.USERNAME ?? "unknown"

  return { config, sources, apiKey: env[config.model.apiKeyEnv] }
}
