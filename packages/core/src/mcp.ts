// MCP servers (requirement 8): built-in and configured servers are registered with the engine per project.
// ${VAR} references are resolved from the environment here, so secrets never appear in config files.
import { expandEnv, type McpConfig, type McpServer } from "@bobi/config"

type Common = { disabled?: boolean; codemode: false; timeout?: { startup?: number; execution?: number } }
export type EngineMcpServer =
  | ({ type: "local"; command: string[]; cwd?: string; environment?: Record<string, string> } & Common)
  | ({ type: "remote"; url: string; headers?: Record<string, string>; oauth: false } & Common)

export type ResolvedMcp = { name: string; server: EngineMcpServer; problem?: string }

function expandMap(values: Record<string, string> | undefined, env: Record<string, string | undefined>, missing: string[]) {
  if (!values) return undefined
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => {
      const out = expandEnv(v, env)
      missing.push(...out.missing)
      return [k, out.value]
    }),
  )
}

/** Translates Bobi MCP servers into engine server configs. Servers with missing variables are disabled. */
export function resolveMcpServers(servers: Record<string, McpServer>, timeout: McpConfig["timeout"], env: Record<string, string | undefined>): ResolvedMcp[] {
  return Object.entries(servers).map(([name, server]) => {
    const missing: string[] = []
    // codemode: false – MCP tools are offered as individual tools, so modes can hide them and each call is approved.
    const common = { codemode: false as const, ...(server.enabled === false ? { disabled: true } : {}), ...(timeout ? { timeout } : {}) }
    const resolved: EngineMcpServer =
      server.type === "local"
        ? { type: "local", command: server.command.map((c) => { const out = expandEnv(c, env); missing.push(...out.missing); return out.value }), ...(server.cwd ? { cwd: server.cwd } : {}), ...(server.env ? { environment: expandMap(server.env, env, missing)! } : {}), ...common }
        : // OAuth stays off: the engine's OAuth flow registers through a vendor service (ADR-0003).
          { type: "remote", url: expandEnv(server.url, env).value, ...(server.headers ? { headers: expandMap(server.headers, env, missing)! } : {}), oauth: false, ...common }
    if (missing.length) return { name, server: { ...resolved, disabled: true }, problem: `missing environment variable(s) ${[...new Set(missing)].join(", ")}` }
    return { name, server: resolved }
  })
}
