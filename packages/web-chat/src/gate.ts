// Gate of the Bobi web chat (ADR-0024): serves the chat page and forwards exactly the API calls the chat needs to the
// Bobi server. Visitors log in with HTTP Basic (user "demo"); the gate adds the server's own credentials, which the
// visitor never sees. Cross-site requests are refused (Origin must match Host), only listed paths and methods pass.
import { timingSafeEqual } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"

export type GateOptions = {
  readonly port: number
  readonly hostname?: string
  /** Password of the visitors (user `demo`). */
  readonly password: string
  /** Bobi server, e.g. http://127.0.0.1:4096, and its password (user `opencode`). */
  readonly upstream: string
  readonly serverPassword: string
  /** The project folder the chat works in; sent to the page as /config.json. */
  readonly directory: string
  /** Where main.js and index.html come from, and the IDE panel's media (chat.js, chat.css, bobi.svg). */
  readonly publicDir: string
  readonly distDir: string
  readonly mediaDir: string
  readonly tls?: { cert: string; key: string }
}

const FILES: Record<string, { dir: "public" | "dist" | "media"; file: string; type: string }> = {
  "/": { dir: "public", file: "index.html", type: "text/html; charset=utf-8" },
  "/main.js": { dir: "dist", file: "main.js", type: "text/javascript; charset=utf-8" },
  "/chat.js": { dir: "media", file: "chat.js", type: "text/javascript; charset=utf-8" },
  "/chat.css": { dir: "media", file: "chat.css", type: "text/css; charset=utf-8" },
  "/bobi.svg": { dir: "media", file: "bobi.svg", type: "image/svg+xml" },
}

/** The API calls of the chat controller. Everything else of the engine's API stays unreachable from the browser. */
const SEG = "[A-Za-z0-9_-]+"
export const ALLOWED: readonly { method: string; path: RegExp }[] = [
  { method: "GET", path: /^\/api\/agent$/ },
  { method: "GET", path: /^\/api\/event$/ },
  { method: "POST", path: /^\/api\/session$/ },
  { method: "POST", path: new RegExp(`^/api/session/${SEG}/(prompt|interrupt|agent|revert/stage|revert/commit)$`) },
  { method: "GET", path: new RegExp(`^/api/session/${SEG}/(permission|message)$`) },
  { method: "POST", path: new RegExp(`^/api/session/${SEG}/permission/${SEG}/reply$`) },
]

const same = (a: string, b: string) => {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cache-control": "no-cache",
} as const

export function startGate(options: GateOptions) {
  const upstreamAuth = `Basic ${btoa(`opencode:${options.serverPassword}`)}`
  const dirs = { public: options.publicDir, dist: options.distDir, media: options.mediaDir }
  const authorized = (request: Request) => {
    const header = request.headers.get("authorization") ?? ""
    if (!header.startsWith("Basic ")) return false
    let decoded: string
    try {
      decoded = atob(header.slice(6))
    } catch {
      return false
    }
    const colon = decoded.indexOf(":")
    return colon > 0 && same(decoded.slice(0, colon), "demo") && same(decoded.slice(colon + 1), options.password)
  }

  return Bun.serve({
    port: options.port,
    hostname: options.hostname ?? "0.0.0.0",
    // Server-sent events stay open for hours.
    idleTimeout: 0,
    ...(options.tls ? { tls: { cert: Bun.file(options.tls.cert), key: Bun.file(options.tls.key) } } : {}),
    async fetch(request) {
      const url = new URL(request.url)
      const plain = (status: number, text: string, extra: Record<string, string> = {}) => new Response(text, { status, headers: { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8", ...extra } })
      if (!authorized(request)) return plain(401, "Login required", { "www-authenticate": 'Basic realm="Bobi Demo"' })
      // Cross-site protection: browsers send Origin on every request that could change something.
      const origin = request.headers.get("origin")
      if (origin !== null && new URL(origin).host !== request.headers.get("host")) return plain(403, "Cross-site request refused")

      if (url.pathname === "/config.json" && request.method === "GET")
        return new Response(JSON.stringify({ directory: options.directory }), { headers: { ...SECURITY_HEADERS, "content-type": "application/json" } })
      const known = FILES[url.pathname]
      if (known && request.method === "GET") {
        try {
          return new Response(readFileSync(path.join(dirs[known.dir], known.file)), { headers: { ...SECURITY_HEADERS, "content-type": known.type } })
        } catch {
          return plain(404, `${known.file} is not built`)
        }
      }

      if (url.pathname.startsWith("/api/")) {
        if (!ALLOWED.some((r) => r.method === request.method && r.path.test(url.pathname))) return plain(404, "Not available")
        const headers = new Headers({ authorization: upstreamAuth, "accept-encoding": "identity" })
        for (const name of ["content-type", "accept"]) {
          const value = request.headers.get(name)
          if (value) headers.set(name, value)
        }
        let response: Response
        try {
          response = await fetch(`${options.upstream}${url.pathname}${url.search}`, {
            method: request.method,
            headers,
            ...(request.method === "GET" ? {} : { body: await request.arrayBuffer() }),
            signal: request.signal,
          })
        } catch {
          return plain(502, "The Bobi server is not reachable")
        }
        const out = new Headers(SECURITY_HEADERS)
        for (const name of ["content-type", "cache-control"]) {
          const value = response.headers.get(name)
          if (value) out.set(name, value)
        }
        out.set("cache-control", "no-store")
        out.set("x-accel-buffering", "no")
        return new Response(response.body, { status: response.status, headers: out })
      }
      return plain(404, "Not found")
    },
  })
}
