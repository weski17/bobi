// The Compose gateway's TCP forwarder (sandbox/forward.ts): large bodies, streaming and WebSockets pass intact.
import { afterAll, beforeAll, expect, test } from "bun:test"
import { startForwarder } from "../../../sandbox/forward.ts"

const big = "x".repeat(8_000_000)
let upstream: ReturnType<typeof Bun.serve>
let forwarder: ReturnType<typeof startForwarder>

beforeAll(() => {
  upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(request, server) {
      const url = new URL(request.url)
      if (url.pathname === "/ws" && server.upgrade(request)) return
      if (url.pathname === "/big") return new Response(big)
      if (url.pathname === "/echo") return new Response(request.body)
      if (url.pathname === "/stream")
        return new Response(
          new ReadableStream({
            async start(c) {
              for (let i = 0; i < 3; i++) {
                c.enqueue(new TextEncoder().encode(`data: ${i}\n\n`))
                await Bun.sleep(20)
              }
              c.close()
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      return new Response("ok")
    },
    websocket: { message: (ws, m) => ws.send(`echo:${m}`) },
  })
  forwarder = startForwarder(0, "127.0.0.1", upstream.port!, "127.0.0.1")
})
afterAll(() => {
  forwarder.stop(true)
  upstream.stop(true)
})

const url = (p: string) => `http://127.0.0.1:${forwarder.port}${p}`

test("forwards large responses and request bodies without loss", async () => {
  expect((await (await fetch(url("/big"))).text()).length).toBe(big.length)
  const body = "y".repeat(3_000_000)
  expect(await (await fetch(url("/echo"), { method: "POST", body })).text()).toBe(body)
})

test("forwards streams and WebSockets", async () => {
  expect(await (await fetch(url("/stream"))).text()).toBe("data: 0\n\ndata: 1\n\ndata: 2\n\n")
  const ws = new WebSocket(`ws://127.0.0.1:${forwarder.port}/ws`)
  const reply = await new Promise<string>((resolve) => {
    ws.onopen = () => ws.send("hi")
    ws.onmessage = (e) => resolve(String(e.data))
  })
  ws.close()
  expect(reply).toBe("echo:hi")
})

test("a closed target ends the client connection", async () => {
  const dead = startForwarder(0, "127.0.0.1", 1, "127.0.0.1")
  try {
    await expect(fetch(`http://127.0.0.1:${dead.port}/`)).rejects.toThrow()
  } finally {
    dead.stop(true)
  }
})
