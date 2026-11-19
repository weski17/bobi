// The Bobi server: the OpenCode engine embedded in-process with @bobi/core registered as a host plugin
// (ADR-0013). A failing host plugin fails startup, so there is no path without Bobi's safeguards.
import { loadConfig, SDK_OFFLINE_OPTIONS, toOpenCodeConfig, TrustStore, type BobiConfig } from "@bobi/config"
import { timingSafeEqual, createHash } from "node:crypto"
import { agentCard, CARD_PATH, httpEngine, InboundA2a, RPC_PATH } from "@bobi/a2a"
import { A2A_AGENT, createBobiCore, type AuditSink } from "@bobi/core"
import { CLI as CODE_GRAPH_CLI } from "@bobi/mcp-code-graph"
import { CLI as COBOL_CLI } from "@bobi/mcp-cobol"
import { CLI as ZOWE_CLI, zoweConfigured } from "@bobi/mcp-zowe"
import { COMPLETE_PATH, handleCompletion } from "./complete.ts"
import { handleTips, TIPS_PATH } from "./tips.ts"
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
  /** Project that tasks from other agents work on (A2A, when config.a2a.enabled). Default: the working directory. */
  readonly directory?: string
}

export type BobiServer = NodeServer

export async function startBobiServer(options: BobiServerOptions): Promise<BobiServer> {
  const { paths } = options
  const env = options.env ?? process.env
  const trust = new TrustStore(paths.home)
  const projectConfig = (project: string, trusted = trust.isTrusted(project)): BobiConfig => {
    const own = loadConfig({ cwd: project, env, trustedProject: trusted }).config
    return { ...own, model: options.config.model, telemetry: options.config.telemetry }
  }
  const plugin = createBobiCore({
    config: options.config,
    globalDir: paths.home,
    trusted: (project) => trust.isTrusted(project),
    // Each project gets its own auto-approvals and mode models; endpoint, model list and telemetry stay server-wide.
    projectConfig: (project, trusted) => projectConfig(project, trusted),
    // Built-in code graph and COBOL MCP servers for every project (requirement 16); usable in modes with the mcp group.
    // The mainframe server only when a connection is configured (Zowe config file or ZOWE_OPT_HOST).
    builtinMcp: (project) => ({
      "code-graph": { type: "local", command: [process.execPath, CODE_GRAPH_CLI, project] },
      cobol: { type: "local", command: [process.execPath, COBOL_CLI, project] },
      ...(zoweConfigured(project, env) ? { zowe: { type: "local" as const, command: [process.execPath, ZOWE_CLI, project] } } : {}),
    }),
    env,
    secrets: options.secrets ?? [],
    ...(options.audit ? { audit: options.audit } : {}),
    ...(options.browser === false ? { browser: false as const } : {}),
  })
  // A2A: discovery card (public) and JSON-RPC endpoint, only when enabled. The endpoint takes its own bearer token
  // (BOBI_A2A_TOKEN), never the server password: the password opens the whole engine API, where a caller could start a
  // session in another mode and approve its own requests (security review 2026-11-19, H2).
  let url = ""
  const inbound = options.config.a2a.enabled
    ? {
        token: requireA2aToken(env.BOBI_A2A_TOKEN, options.password),
        a2a: new InboundA2a({
          engine: httpEngine({ url: () => url, password: options.password, directory: options.directory ?? process.cwd() }),
          agent: A2A_AGENT,
          mask: plugin.mask,
        }),
      }
    : undefined
  const a2a = inbound?.a2a
  const server = await startNodeServer({
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
    routes: {
      match: (pathname) => {
        if (pathname === COMPLETE_PATH || pathname === TIPS_PATH) return "private"
        if (a2a && pathname === CARD_PATH) return "public"
        if (a2a && pathname === RPC_PATH) return "own"
        return undefined
      },
      handle: async (request) => {
        const { pathname, origin } = new URL(request.url)
        if (pathname === CARD_PATH) return Response.json(agentCard({ baseUrl: origin, version: options.engineVersion ?? "local" }))
        if (pathname === RPC_PATH) return handleA2a(request, inbound!.a2a, inbound!.token)
        if (pathname === TIPS_PATH) return handleTips(request, projectConfig)
        return handleCompletion(request, { projectConfig, env, mask: plugin.mask })
      },
    },
    password: options.password,
    ...(options.hostname ? { hostname: options.hostname } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
  })
  url = server.url
  return server
}

/** The A2A endpoint: only with its own token. */
function handleA2a(request: Request, a2a: InboundA2a, token: string): Promise<Response> | Response {
  if (!bearerMatches(request.headers.get("authorization"), token))
    return new Response("A2A token required", { status: 401, headers: { "www-authenticate": 'Bearer realm="bobi-a2a"' } })
  return a2a.handle(request)
}

/** Minimum length of the inbound A2A token. */
export const A2A_TOKEN_MIN = 24

/** The inbound A2A token: required when A2A is on, long enough, and never the server password. */
export function requireA2aToken(token: string | undefined, serverPassword: string): string {
  if (!token) throw new Error(`a2a.enabled needs BOBI_A2A_TOKEN (at least ${A2A_TOKEN_MIN} characters), a token only for other agents`)
  if (token.length < A2A_TOKEN_MIN) throw new Error(`BOBI_A2A_TOKEN must have at least ${A2A_TOKEN_MIN} characters`)
  if (token === serverPassword) throw new Error("BOBI_A2A_TOKEN must differ from the server password")
  return token
}

/** Constant-time check of an `Authorization: Bearer <token>` header. */
export function bearerMatches(header: string | null, token: string): boolean {
  const match = /^Bearer (.+)$/.exec(header ?? "")
  if (!match) return false
  const digest = (v: string) => createHash("sha256").update(v).digest()
  return timingSafeEqual(digest(match[1]!), digest(token))
}
