// The Bobi server: the OpenCode engine embedded in-process with @bobi/core registered as a host plugin
// (ADR-0013). A failing host plugin fails startup, so there is no path without Bobi's safeguards.
import { loadConfig, SDK_OFFLINE_OPTIONS, toOpenCodeConfig, TrustStore, type BobiConfig } from "@bobi/config"
import { createBobiCore, type AuditSink } from "@bobi/core"
import { startNodeServer, type NodeServer } from "./node-host.ts"
import type { BobiPaths } from "./paths.ts"

export const USERNAME = "opencode" // the engine's terminal client authenticates with this user name

export type BobiServerOptions = {
  readonly config: BobiConfig
  readonly paths: BobiPaths
  readonly password: string
  readonly hostname?: string
  readonly port?: number
  readonly secrets?: readonly (string | undefined)[]
  readonly audit?: AuditSink
  /** Version reported to engine clients (default "local", as when running from source). */
  readonly engineVersion?: string
  /** Register the headless browser tool (default true). */
  readonly browser?: boolean
  /** Environment for per-project config loading (default process.env). */
  readonly env?: Record<string, string | undefined>
}

export type BobiServer = NodeServer

export async function startBobiServer(options: BobiServerOptions): Promise<BobiServer> {
  const { paths } = options
  const env = options.env ?? process.env
  const trust = new TrustStore(paths.home)
  const plugin = createBobiCore({
    config: options.config,
    globalDir: paths.home,
    trusted: (project) => trust.isTrusted(project),
    // Each project gets its own auto-approvals and mode models; endpoint, model list and telemetry stay server-wide.
    projectConfig: (project, trusted) => {
      const own = loadConfig({ cwd: project, env, trustedProject: trusted }).config
      return { ...own, model: options.config.model, telemetry: options.config.telemetry }
    },
    secrets: options.secrets ?? [],
    ...(options.audit ? { audit: options.audit } : {}),
    ...(options.browser === false ? { browser: false as const } : {}),
  })
  return startNodeServer({
    engine: {
      // Clients built from source report version "local"; matching it avoids a version-mismatch warning.
      app: { name: "bobi", version: options.engineVersion ?? "local", channel: "local" },
      // project: false – a repository must not be able to load engine config or plugins (.opencode/plugins/*.ts
      // would run code in the server). Project settings come from .bobi/ via @bobi/core, subject to trust.
      config: { directory: paths.config, project: false, claude: false, content: JSON.stringify(toOpenCodeConfig(options.config)) },
      database: { path: paths.database },
      events: { persist: true },
      fs: { filewatcher: true },
      ...SDK_OFFLINE_OPTIONS,
    },
    paths,
    plugin,
    password: options.password,
    ...(options.hostname ? { hostname: options.hostname } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
  })
}
