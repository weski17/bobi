// Minimal forward proxy enforcing the egress allowlist. Supports CONNECT (HTTPS) and absolute-form
// HTTP requests. Everything else is refused. No TLS interception: Bobi only decides *where* traffic goes.
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"
import type { Socket, TCPSocketListener } from "bun"
import { isPrivateAddress } from "./address.ts"
import { matchRule, parseTarget, type Rule, type Target } from "./allowlist.ts"

export type Decision = { time: string; method: string; target: string; allowed: boolean }

export type ProxyOptions = {
  readonly rules: readonly Rule[]
  readonly hostname?: string
  readonly port?: number
  readonly log?: (decision: Decision) => void
  /** Resolves a host name to IP addresses (default: the system resolver). */
  readonly resolve?: (host: string) => Promise<string[]>
  /** Seconds a client may take to send its request head (default 10). */
  readonly headerTimeoutSeconds?: number
  /** Seconds a tunnel may stay idle (default 300). */
  readonly idleTimeoutSeconds?: number
  /** Open client connections at most (default 256); more get 503. */
  readonly maxConnections?: number
}

const systemResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address)

/**
 * Resolves the target once and returns the address to connect to (the name is not resolved again, so it cannot
 * change in between). A wildcard rule never leads to a private, loopback or link-local address: anyone who can add a
 * record below the allowed domain could otherwise point it at internal systems. An exact rule may name an internal
 * host on purpose (e.g. the model gateway). Security review 2026-11-19, M6.
 */
async function resolveTarget(target: Target, rule: Rule, resolve: (host: string) => Promise<string[]>): Promise<string | undefined> {
  const host = target.host.replace(/^\[|\]$/g, "")
  if (isIP(host)) return rule.wildcard && isPrivateAddress(host) ? undefined : host
  const addresses = await resolve(host).catch(() => [] as string[])
  if (addresses.length === 0) return undefined
  if (rule.wildcard && addresses.some(isPrivateAddress)) return undefined
  return addresses[0]
}

type State = { buffer: Buffer; upstream?: Socket<undefined>; pending: Buffer[]; done: boolean }

const MAX_HEADER = 64 * 1024

function reply(socket: Socket<State>, status: string) {
  socket.end(`HTTP/1.1 ${status}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`)
}

export type RunningProxy = { readonly port: number; readonly url: string; stop(): void }

export function startProxy(options: ProxyOptions): RunningProxy {
  const log = options.log ?? ((d) => console.log(JSON.stringify(d)))
  const resolve = options.resolve ?? systemResolve
  const idle = options.idleTimeoutSeconds ?? 300
  let open = 0

  const tunnel = async (client: Socket<State>, address: string, port: number, first: Buffer | undefined) => {
    try {
      const upstream = await Bun.connect({
        hostname: address,
        port,
        socket: {
          data: (_s, data) => void client.write(data),
          close: () => void client.end(),
          error: () => void client.end(),
          timeout: (s) => void s.end(),
        },
      })
      upstream.timeout(idle)
      client.timeout(idle)
      client.data.upstream = upstream
      if (first?.length) upstream.write(first)
      for (const chunk of client.data.pending.splice(0)) upstream.write(chunk)
      return upstream
    } catch {
      reply(client, "502 Bad Gateway")
      return undefined
    }
  }

  const handleHead = async (client: Socket<State>, head: string, rest: Buffer) => {
    const [requestLine = ""] = head.split("\r\n")
    const [method = "", uri = ""] = requestLine.split(" ")
    let target: Target | undefined
    let forward: Buffer | undefined
    if (method === "CONNECT") {
      target = parseTarget(uri, 443)
    } else if (/^http:\/\//i.test(uri)) {
      const url = URL.canParse(uri) ? new URL(uri) : undefined
      target = url ? { host: url.hostname, port: Number(url.port || 80) } : undefined
      if (url) {
        // Rewrite to origin-form and force one request per connection: with keep-alive, later requests on the
        // same client connection would reach the upstream without being checked and logged.
        const lines = head.slice(0, -4).split("\r\n")
        lines[0] = `${method} ${url.pathname}${url.search} ${requestLine.split(" ")[2] ?? "HTTP/1.1"}`
        // The Host header names the target the allowlist checked, never what the client claims (one allowed gateway
        // could otherwise be asked for another virtual host).
        const headers = lines.filter((l, i) => i === 0 || !/^(proxy-[a-z-]*|connection|keep-alive|host)\s*:/i.test(l))
        forward = Buffer.concat([Buffer.from(`${[...headers, `host: ${url.host}`, "connection: close"].join("\r\n")}\r\n\r\n`), rest])
      }
    }
    const rule = target ? matchRule(target, options.rules) : undefined
    const address = target && rule ? await resolveTarget(target, rule, resolve) : undefined
    const ok = address !== undefined
    log({ time: new Date().toISOString(), method, target: target ? `${target.host}:${target.port}` : uri.slice(0, 200), allowed: ok })
    if (!target) return reply(client, "400 Bad Request")
    if (!ok) return reply(client, "403 Forbidden")
    if (method === "CONNECT") {
      const upstream = await tunnel(client, address, target.port, rest)
      if (upstream) client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    } else {
      await tunnel(client, address, target.port, forward)
    }
  }

  const server: TCPSocketListener<State> = Bun.listen<State>({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    socket: {
      open: (socket) => {
        socket.data = { buffer: Buffer.alloc(0), pending: [], done: false }
        open++
        if (open > (options.maxConnections ?? 256)) return reply(socket, "503 Service Unavailable")
        socket.timeout(options.headerTimeoutSeconds ?? 10)
      },
      timeout: (socket) => void socket.end(),
      data: (socket, chunk) => {
        const state = socket.data
        if (state.upstream) return void state.upstream.write(chunk)
        if (state.done) return void state.pending.push(Buffer.from(chunk))
        state.buffer = Buffer.concat([state.buffer, chunk])
        const end = state.buffer.indexOf("\r\n\r\n")
        if (end === -1) {
          if (state.buffer.length > MAX_HEADER) reply(socket, "431 Request Header Fields Too Large")
          return
        }
        state.done = true
        void handleHead(socket, state.buffer.subarray(0, end + 4).toString("latin1"), state.buffer.subarray(end + 4))
      },
      close: (socket) => {
        open--
        socket.data?.upstream?.end()
      },
      error: (socket) => void socket.data?.upstream?.end(),
    },
  })
  return { port: server.port, url: `http://${server.hostname}:${server.port}`, stop: () => server.stop(true) }
}
