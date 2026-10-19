// Embeds the OpenCode engine in-process with @bobi/core registered as a host plugin.
// Unlike loading a plugin through config, a host plugin cannot be silently skipped: if it fails,
// host creation fails (ADR-0013).
import path from "node:path"
import { SDK_OFFLINE_OPTIONS, toOpenCodeConfig, type BobiConfig } from "@bobi/config"
import { createBobiCore, type AuditSink } from "@bobi/core"
import { Effect } from "effect"
import type { BobiPaths } from "./paths.ts"

// The Promise SDK does not expose the raw request handler; the embedded host module does.
const EMBEDDED_HOST = path.resolve(import.meta.dir, "..", "..", "..", "vendor", "opencode", "packages", "sdk", "src", "internal", "host.ts")

export type HostOptions = {
  readonly config: BobiConfig
  readonly paths: BobiPaths
  readonly secrets?: readonly (string | undefined)[]
  readonly audit?: AuditSink
  /** Version reported to engine clients (default "local", as when running from source). */
  readonly engineVersion?: string
  /** Register the headless browser tool (default true). */
  readonly browser?: boolean
}

export type Host = {
  readonly fetch: (request: Request) => Promise<Response>
  readonly close: () => Promise<void>
}

export async function createHost(options: HostOptions): Promise<Host> {
  const [{ EmbeddedHost }, { PluginPromise }, { Global }] = await Promise.all([
    import(EMBEDDED_HOST),
    import("@opencode/core/plugin/promise"),
    import("@opencode/util/global"),
  ])
  const core = createBobiCore({
    config: options.config,
    secrets: options.secrets ?? [],
    ...(options.audit ? { audit: options.audit } : {}),
    ...(options.browser === false ? { browser: false as const } : {}),
  })
  const { paths } = options
  const host: { fetch(request: Request): Promise<Response>; close(): Promise<void> } = await Effect.runPromise(
    EmbeddedHost.create(
      {
        // Clients built from source report version "local"; matching it avoids a version-mismatch warning.
        app: { name: "bobi", version: options.engineVersion ?? "local", channel: "local" },
        // project: false – a repository must not be able to load OpenCode config or plugins (.opencode/plugins/*.ts
        // would run code in the server). Project settings come from .bobi/ via @bobi/core.
        config: { directory: paths.config, project: false, claude: false, content: JSON.stringify(toOpenCodeConfig(options.config)) },
        database: { path: paths.database },
        events: { persist: true },
        fs: { filewatcher: true },
        ...SDK_OFFLINE_OPTIONS,
        plugins: [PluginPromise.fromPromise(core)],
      },
      {
        overrides: [
          Global.node.replace(
            Global.layerWith({
              data: paths.data,
              cache: paths.cache,
              config: paths.config,
              state: paths.state,
              log: paths.log,
              bin: paths.bin,
              repos: paths.repos,
            }),
          ),
        ],
      },
    ),
  )
  return {
    fetch: (request) => host.fetch(request),
    close: async () => {
      await host.close()
    },
  }
}
