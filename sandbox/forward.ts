#!/usr/bin/env bun
// TCP forwarder for the Docker Compose setup: Docker cannot publish ports of a container that is only on an
// internal network, so this tiny gateway sits on both networks and forwards one port to the Bobi server.
// It forwards bytes only (HTTP, SSE and WebSockets pass through); authentication stays with the server.
//   bun sandbox/forward.ts <listen-port> <target-host>:<target-port>
import type { Socket } from "bun"

/** A socket with an outgoing buffer: `write` may accept only part of a chunk; the rest goes out on `drain`. */
class Pipe {
  private queue: Uint8Array[] = []
  private ending = false
  constructor(private socket: Socket<unknown>) {}
  send(chunk: Uint8Array) {
    if (this.queue.length) return void this.queue.push(chunk)
    const written = this.socket.write(chunk)
    if (written < chunk.byteLength) this.queue.push(chunk.subarray(Math.max(0, written)))
  }
  drain() {
    while (this.queue.length) {
      const chunk = this.queue[0]!
      const written = this.socket.write(chunk)
      if (written < chunk.byteLength) {
        this.queue[0] = chunk.subarray(Math.max(0, written))
        return
      }
      this.queue.shift()
    }
    if (this.ending) this.socket.end()
  }
  /** Closes after everything queued has been written. */
  end() {
    this.ending = true
    if (!this.queue.length) this.socket.end()
  }
}

type ClientState = { toClient?: Pipe; toUpstream?: Pipe; upstream?: Socket<unknown>; pending: Uint8Array[] }

function closeUpstream(state: ClientState) {
  if (state.toUpstream) state.toUpstream.end()
  else state.upstream?.end()
}

export function startForwarder(listenPort: number, targetHost: string, targetPort: number, hostname = "0.0.0.0") {
  return Bun.listen<ClientState>({
    hostname,
    port: listenPort,
    socket: {
      async open(client) {
        client.data = { pending: [], toClient: new Pipe(client as Socket<unknown>) }
        try {
          const upstream = await Bun.connect({
            hostname: targetHost,
            port: targetPort,
            socket: {
              data: (_u, chunk) => client.data.toClient!.send(new Uint8Array(chunk)),
              drain: () => client.data.toUpstream?.drain(),
              close: () => client.data.toClient!.end(),
              error: () => client.data.toClient!.end(),
            },
          })
          client.data.upstream = upstream as Socket<unknown>
          client.data.toUpstream = new Pipe(upstream as Socket<unknown>)
          for (const chunk of client.data.pending) client.data.toUpstream.send(chunk)
          client.data.pending = []
        } catch {
          void client.end()
        }
      },
      data(client, chunk) {
        const copy = new Uint8Array(chunk)
        if (client.data.toUpstream) client.data.toUpstream.send(copy)
        else client.data.pending.push(copy)
      },
      drain: (client) => client.data.toClient?.drain(),
      close: (client) => closeUpstream(client.data),
      error: (client) => closeUpstream(client.data),
    },
  })
}

if (import.meta.main) {
  const [listen, target] = process.argv.slice(2)
  const [host, port] = (target ?? "").split(":")
  if (!listen || !host || !port) {
    console.error("usage: bun sandbox/forward.ts <listen-port> <target-host>:<target-port>")
    process.exit(2)
  }
  startForwarder(Number(listen), host, Number(port))
  console.log(`forwarding :${listen} -> ${host}:${port}`)
}
