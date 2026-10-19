// Minimal forward proxy enforcing the egress allowlist. Supports CONNECT (HTTPS) and absolute-form
// HTTP requests. Everything else is refused. No TLS interception: Bobi only decides *where* traffic goes.
import type { Socket, TCPSocketListener } from "bun"
import { allowed, parseTarget, type Rule, type Target } from "./allowlist.ts"

export type Decision = { time: string; method: string; target: string; allowed: boolean }

export type ProxyOptions = {
  readonly rules: readonly Rule[]
  readonly hostname?: string
  readonly port?: number
  readonly log?: (decision: Decision) => void
}

type State = { buffer: Buffer; upstream?: Socket<undefined>; pending: Buffer[]; done: boolean }

const MAX_HEADER = 64 * 1024

function reply(socket: Socket<State>, status: string) {
  socket.end(`HTTP/1.1 ${status}\r\nconnection: close\r\ncontent-length: 0\r\n\r\n`)
}

export type RunningProxy = { readonly port: number; readonly url: string; stop(): void }

export function startProxy(options: ProxyOptions): RunningProxy {
  const log = options.log ?? ((d) => console.log(JSON.stringify(d)))

  const tunnel = async (client: Socket<State>, target: Target, first: Buffer | undefined) => {
    try {
      const upstream = await Bun.connect({
        hostname: target.host.replace(/^\[|\]$/g, ""),
        port: target.port,
        socket: {
          data: (_s, data) => void client.write(data),
          close: () => void client.end(),
          error: () => void client.end(),
        },
      })
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
        const headers = lines.filter((l, i) => i === 0 || !/^(proxy-[a-z-]*|connection|keep-alive)\s*:/i.test(l))
        forward = Buffer.concat([Buffer.from(`${[...headers, "connection: close"].join("\r\n")}\r\n\r\n`), rest])
      }
    }
    const ok = target !== undefined && allowed(target, options.rules)
    log({ time: new Date().toISOString(), method, target: target ? `${target.host}:${target.port}` : uri.slice(0, 200), allowed: ok })
    if (!target) return reply(client, "400 Bad Request")
    if (!ok) return reply(client, "403 Forbidden")
    if (method === "CONNECT") {
      const upstream = await tunnel(client, target, rest)
      if (upstream) client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
    } else {
      await tunnel(client, target, forward)
    }
  }

  const server: TCPSocketListener<State> = Bun.listen<State>({
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    socket: {
      open: (socket) => {
        socket.data = { buffer: Buffer.alloc(0), pending: [], done: false }
      },
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
      close: (socket) => void socket.data?.upstream?.end(),
      error: (socket) => void socket.data?.upstream?.end(),
    },
  })
  return { port: server.port, url: `http://${server.hostname}:${server.port}`, stop: () => server.stop(true) }
}
