// The Bobi HTTP server: password-protected front for the embedded engine.
import { timingSafeEqual } from "node:crypto"
import type { Host } from "./host.ts"

export const USERNAME = "opencode" // the OpenCode CLI/TUI client authenticates with this user name

export type ServeOptions = {
  readonly host: Host
  readonly password: string
  readonly hostname?: string
  readonly port?: number
}

export type RunningServer = { readonly url: string; stop(): Promise<void> }

function authorized(header: string | null, password: string): boolean {
  if (!header?.startsWith("Basic ")) return false
  const expected = Buffer.from(`${USERNAME}:${password}`)
  const given = Buffer.from(Buffer.from(header.slice(6), "base64").toString("utf8"))
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export function serve(options: ServeOptions): RunningServer {
  if (options.password.length < 16) throw new Error("server password must have at least 16 characters")
  const server = Bun.serve({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    idleTimeout: 0, // event streams stay open
    fetch(request) {
      if (!authorized(request.headers.get("authorization"), options.password)) {
        return new Response("unauthorized", { status: 401, headers: { "www-authenticate": 'Basic realm="bobi"' } })
      }
      return options.host.fetch(request)
    },
  })
  return {
    url: `http://${server.hostname}:${server.port}`,
    async stop() {
      await server.stop(true)
    },
  }
}
