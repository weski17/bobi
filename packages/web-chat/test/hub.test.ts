// The event hub against a fake Bobi server that sends server-sent events: batching, waiting, limits and reconnecting.
import { afterEach, expect, test } from "bun:test"
import { EventHub, frames } from "../src/hub.ts"

type Fake = { url: string; send: (event: unknown, raw?: string) => void; drop: () => void; hits: () => number; stop: () => void }
const stoppers: (() => void)[] = []
afterEach(() => {
  for (const stop of stoppers.splice(0)) stop()
})

/** A server whose /api/event keeps a stream open; `send` writes a frame, `drop` ends the stream. */
function fakeServer(options: { status?: number } = {}): Fake {
  const encoder = new TextEncoder()
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let hits = 0
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    fetch(request) {
      if (new URL(request.url).pathname !== "/api/event") return new Response("no", { status: 404 })
      hits++
      if (options.status) return new Response("down", { status: options.status })
      if (request.headers.get("authorization") !== "Basic abc") return new Response("login", { status: 401 })
      return new Response(new ReadableStream({ start: (c) => void (controller = c) }), { headers: { "content-type": "text/event-stream" } })
    },
  })
  const fake: Fake = {
    url: `http://127.0.0.1:${server.port}`,
    send: (event, raw) => controller?.enqueue(encoder.encode(raw ?? `data: ${JSON.stringify(event)}\n\n`)),
    drop: () => {
      controller?.close()
      controller = undefined
    },
    hits: () => hits,
    stop: () => void server.stop(true),
  }
  stoppers.push(fake.stop)
  return fake
}

const hubFor = (fake: Fake, limit?: number) => {
  const hub = new EventHub(fake.url, "Basic abc", limit)
  stoppers.push(() => hub.close())
  return hub
}
const until = async (check: () => boolean, ms = 5000) => {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out")
    await Bun.sleep(10)
  }
}

test("frames: complete frames come out, an unfinished one stays; only data lines count", () => {
  expect(frames('data: {"a":1}\n\ndata: {"b":2}\n\nda')).toEqual({ data: ['{"a":1}', '{"b":2}'], rest: "da" })
  expect(frames(": comment\nevent: x\nid: 7\ndata: one\ndata: two\n\n").data).toEqual(["one\ntwo"])
  expect(frames("event: ping\n\n").data).toEqual([])
  expect(frames("").rest).toBe("")
})

test("events arrive in order with growing numbers; a browser asks for what comes after what it has", async () => {
  const fake = fakeServer()
  const hub = hubFor(fake)
  await until(() => fake.hits() === 1)
  fake.send({ type: "a" })
  fake.send({ type: "b" })
  await until(() => hub.last === 2)
  expect(await hub.since(0, 0)).toEqual({ last: 2, events: [{ type: "a" }, { type: "b" }] })
  expect(await hub.since(1, 0)).toEqual({ last: 2, events: [{ type: "b" }] })
  expect(await hub.since(2, 0)).toEqual({ last: 2, events: [] })
})

test("an empty poll waits and is answered as soon as an event comes", async () => {
  const fake = fakeServer()
  const hub = hubFor(fake)
  await until(() => fake.hits() === 1)
  const began = Date.now()
  const waiting = hub.since(0, 5000)
  await Bun.sleep(100)
  fake.send({ type: "late" })
  expect(await waiting).toEqual({ last: 1, events: [{ type: "late" }] })
  expect(Date.now() - began).toBeLessThan(2000)
})

test("a poll that times out answers empty; an aborted request is released at once", async () => {
  const fake = fakeServer()
  const hub = hubFor(fake)
  await until(() => fake.hits() === 1)
  const began = Date.now()
  expect(await hub.since(0, 150)).toEqual({ last: 0, events: [] })
  expect(Date.now() - began).toBeGreaterThanOrEqual(140)
  const abort = new AbortController()
  const released = hub.since(0, 10_000, abort.signal)
  setTimeout(() => abort.abort(), 50)
  expect(await released).toEqual({ last: 0, events: [] })
})

test("many browsers can ask at the same time and each gets the same events", async () => {
  const fake = fakeServer()
  const hub = hubFor(fake)
  await until(() => fake.hits() === 1)
  const polls = [hub.since(0, 5000), hub.since(0, 5000), hub.since(0, 5000)]
  await Bun.sleep(50)
  fake.send({ type: "x" })
  for (const r of await Promise.all(polls)) expect(r.events).toEqual([{ type: "x" }])
  expect(fake.hits()).toBe(1)
})

test("only the newest events are kept; an old cursor still gets what is left", async () => {
  const fake = fakeServer()
  const hub = hubFor(fake, 3)
  await until(() => fake.hits() === 1)
  for (let i = 1; i <= 5; i++) fake.send({ n: i })
  await until(() => hub.last === 5)
  expect((await hub.since(0, 0)).events).toEqual([{ n: 3 }, { n: 4 }, { n: 5 }])
})

test("a cursor from the future (the gate was restarted) is reset to the current position", async () => {
  const fake = fakeServer()
  const hub = hubFor(fake)
  await until(() => fake.hits() === 1)
  fake.send({ n: 1 })
  await until(() => hub.last === 1)
  expect(await hub.since(99, 5000)).toEqual({ last: 1, events: [] })
})

test("malformed frames and comments are ignored, split frames are put together", async () => {
  const fake = fakeServer()
  const hub = hubFor(fake)
  await until(() => fake.hits() === 1)
  fake.send(undefined, "data: not json\n\n")
  fake.send(undefined, ": keep-alive\n\n")
  fake.send(undefined, 'data: {"ok":')
  fake.send(undefined, "true}\n\n")
  await until(() => hub.last === 1)
  expect((await hub.since(0, 0)).events).toEqual([{ ok: true }])
})

test("after the server drops the stream the hub reconnects and carries on numbering", async () => {
  const fake = fakeServer()
  const hub = hubFor(fake)
  await until(() => fake.hits() === 1)
  fake.send({ n: 1 })
  await until(() => hub.last === 1)
  fake.drop()
  await until(() => fake.hits() === 2, 8000)
  fake.send({ n: 2 })
  await until(() => hub.last === 2)
  expect((await hub.since(1, 0)).events).toEqual([{ n: 2 }])
})

test("a server that is down or refuses the login is retried, nothing crashes", async () => {
  const refusing = fakeServer({ status: 503 })
  const hub = hubFor(refusing)
  await until(() => refusing.hits() >= 2, 8000)
  expect(await hub.since(0, 0)).toEqual({ last: 0, events: [] })
  const wrong = fakeServer()
  const bad = new EventHub(wrong.url, "Basic nope")
  stoppers.push(() => bad.close())
  await until(() => wrong.hits() >= 2, 8000)
  expect(bad.last).toBe(0)
})

test("close ends waiting polls and stops reconnecting", async () => {
  const fake = fakeServer()
  const hub = new EventHub(fake.url, "Basic abc")
  await until(() => fake.hits() === 1)
  const waiting = hub.since(0, 10_000)
  hub.close()
  expect(await waiting).toEqual({ last: 0, events: [] })
  fake.drop()
  await Bun.sleep(1500)
  expect(fake.hits()).toBe(1)
})
