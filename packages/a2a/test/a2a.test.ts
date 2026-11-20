import { afterEach, expect, test } from "bun:test"
import { agentCard, callAgent, CARD_PATH, ERRORS, fetchCard, httpEngine, InboundA2a, RPC_PATH, textOf, type Engine, type Message, type Task } from "../src/index.ts"

const servers: { stop(force?: boolean): void }[] = []
afterEach(() => {
  for (const s of servers.splice(0)) s.stop(true)
})

/** Fake engine: answers after `delay` polls with "answer to <prompt>". */
function fakeEngine(options: { delay?: number; fail?: boolean } = {}) {
  const prompts: { sessionID: string; text: string }[] = []
  const polls = new Map<string, number>()
  let sessions = 0
  const interrupted: string[] = []
  const engine: Engine = {
    createSession: async (agent) => `ses_${agent}_${++sessions}`,
    prompt: async (sessionID, text) => {
      if (options.fail) throw new Error("engine down")
      prompts.push({ sessionID, text })
      polls.set(sessionID, 0)
    },
    answer: async (sessionID) => {
      const n = (polls.get(sessionID) ?? 0) + 1
      polls.set(sessionID, n)
      return n > (options.delay ?? 0) ? `answer to ${prompts.filter((p) => p.sessionID === sessionID).at(-1)!.text} token=SECRET` : undefined
    },
    interrupt: async (sessionID) => void interrupted.push(sessionID),
  }
  return { engine, prompts, interrupted }
}

const user = (text: string, extra: Partial<Message> = {}): Message => ({ kind: "message", role: "user", parts: [{ kind: "text", text }], messageId: crypto.randomUUID(), ...extra })
const send = (a2a: InboundA2a, message: Message, blocking?: boolean) =>
  a2a.rpc({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message, ...(blocking === undefined ? {} : { configuration: { blocking } }) } })

test("agent card follows the A2A shape", () => {
  const card = agentCard({ baseUrl: "http://bobi:4096/", version: "1.2.3" })
  expect(card).toMatchObject({ protocolVersion: "0.3.0", url: "http://bobi:4096/a2a", preferredTransport: "JSONRPC", version: "1.2.3", security: [{ bearer: [] }] })
  expect(card.capabilities.streaming).toBe(false)
  expect(card.skills[0]!.tags).toContain("read-only")
  expect(agentCard({ baseUrl: "http://x", version: "1", name: "N", description: "D" })).toMatchObject({ name: "N", description: "D" })
})

test("message/send runs a task in the a2a agent's session; the context keeps the session", async () => {
  const { engine, prompts } = fakeEngine()
  const a2a = new InboundA2a({ engine, agent: "a2a", pollMs: 1, mask: (t) => t.replace("SECRET", "***") })
  const first = (await send(a2a, user("where is login?"))) as { result: Task }
  expect(first.result).toMatchObject({ kind: "task", status: { state: "completed" } })
  expect(textOf(first.result.artifacts![0]!.parts)).toBe("answer to where is login? token=***")
  expect(textOf(first.result.status.message!.parts)).toContain("answer to where is login?")
  const followUp = (await send(a2a, user("and logout?", { contextId: first.result.contextId }))) as { result: Task }
  expect(followUp.result.contextId).toBe(first.result.contextId)
  expect(prompts.map((p) => p.sessionID)).toEqual(["ses_a2a_1", "ses_a2a_1"])
  const fresh = (await send(a2a, user("new", { contextId: "unknown-context" }))) as { result: Task }
  expect(fresh.result.contextId).not.toBe("unknown-context")
  expect((await a2a.rpc({ jsonrpc: "2.0", id: 2, method: "tasks/get", params: { id: first.result.id } })) as { result: Task }).toMatchObject({ result: { id: first.result.id } })
})

test("non-blocking send, polling, cancel and the limit on running tasks", async () => {
  const { engine, interrupted } = fakeEngine({ delay: 1_000_000 })
  const a2a = new InboundA2a({ engine, agent: "a2a", pollMs: 1, maxWorking: 1 })
  const started = (await send(a2a, user("long"), false)) as { result: Task }
  expect(started.result.status.state).toBe("working")
  const busy = (await send(a2a, user("another"), false)) as { error: { code: number; message: string } }
  expect(busy.error).toMatchObject({ code: ERRORS.internal, message: expect.stringContaining("too many tasks") })
  const canceled = (await a2a.rpc({ jsonrpc: "2.0", id: 3, method: "tasks/cancel", params: { id: started.result.id } })) as { result: Task }
  expect(canceled.result.status.state).toBe("canceled")
  expect(interrupted).toEqual(["ses_a2a_1"])
  const again = (await a2a.rpc({ jsonrpc: "2.0", id: 4, method: "tasks/cancel", params: { id: started.result.id } })) as { error: { code: number } }
  expect(again.error.code).toBe(ERRORS.taskNotCancelable)
  const timed = new InboundA2a({ engine: fakeEngine({ delay: 1_000_000 }).engine, agent: "a2a", pollMs: 1, waitMs: 20 })
  expect(((await send(timed, user("slow"))) as { result: Task }).result.status.state).toBe("working")
})

test("engine failures fail the task", async () => {
  const a2a = new InboundA2a({ engine: fakeEngine({ fail: true }).engine, agent: "a2a" })
  const result = (await send(a2a, user("x"))) as { result: Task }
  expect(result.result.status.state).toBe("failed")
  expect(textOf(result.result.status.message!.parts)).toContain("engine down")
})

test("JSON-RPC errors", async () => {
  const a2a = new InboundA2a({ engine: fakeEngine().engine, agent: "a2a" })
  const code = async (request: unknown) => ((await a2a.rpc(request as never)) as { error: { code: number } }).error.code
  expect(await code({ jsonrpc: "1.0", id: 1, method: "x" })).toBe(ERRORS.invalidRequest)
  expect(await code(null)).toBe(ERRORS.invalidRequest)
  expect(await code({ jsonrpc: "2.0", id: 1, method: "nope" })).toBe(ERRORS.methodNotFound)
  expect(await code({ jsonrpc: "2.0", id: 1, method: "message/stream" })).toBe(ERRORS.unsupported)
  expect(await code({ jsonrpc: "2.0", id: 1, method: "tasks/resubscribe" })).toBe(ERRORS.unsupported)
  expect(await code({ jsonrpc: "2.0", id: 1, method: "tasks/pushNotificationConfig/set" })).toBe(ERRORS.pushNotSupported)
  expect(await code({ jsonrpc: "2.0", id: 1, method: "message/send", params: {} })).toBe(ERRORS.invalidParams)
  expect(await code({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { role: "agent", parts: [] } } })).toBe(ERRORS.invalidParams)
  expect(await code({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message: { role: "user", parts: [{ kind: "file", file: {} }] } } })).toBe(ERRORS.contentType)
  expect(await code({ jsonrpc: "2.0", id: 1, method: "message/send", params: { message: user("x", { taskId: "nope" }) } })).toBe(ERRORS.taskNotFound)
  expect(await code({ jsonrpc: "2.0", id: 1, method: "tasks/get", params: { id: "nope" } })).toBe(ERRORS.taskNotFound)
  expect(await code({ jsonrpc: "2.0", id: 1, method: "tasks/cancel", params: {} })).toBe(ERRORS.taskNotFound)
  const http = await a2a.handle(new Request("http://x/a2a", { method: "POST", body: "{bad" }))
  expect(((await http.json()) as { error: { code: number } }).error.code).toBe(ERRORS.parse)
  expect((await a2a.handle(new Request("http://x/a2a"))).status).toBe(405)
  const ok = await a2a.handle(new Request("http://x/a2a", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tasks/get", params: { id: "x" } }) }))
  expect(((await ok.json()) as { id: number }).id).toBe(7)
})

/** A remote A2A agent backed by InboundA2a with a fake engine. */
function remoteAgent(options: { cardUrl?: (origin: string) => string; delay?: number; token?: string; messageResult?: boolean } = {}) {
  const a2a = new InboundA2a({ engine: fakeEngine({ delay: options.delay }).engine, agent: "remote", pollMs: 1, waitMs: 5 })
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (options.token && request.headers.get("authorization") !== `Bearer ${options.token}`) return new Response("no", { status: 401 })
      if (url.pathname === CARD_PATH) return Response.json({ ...agentCard({ baseUrl: url.origin, version: "1" }), ...(options.cardUrl ? { url: options.cardUrl(url.origin) } : {}) })
      if (url.pathname === RPC_PATH && options.messageResult) {
        const body = (await request.json()) as { id: number }
        return Response.json({ jsonrpc: "2.0", id: body.id, result: { kind: "message", role: "agent", parts: [{ kind: "text", text: "direct" }], messageId: "m", contextId: "c1" } })
      }
      if (url.pathname === RPC_PATH) return a2a.handle(request)
      return new Response("not found", { status: 404 })
    },
  })
  servers.push(server)
  return `http://127.0.0.1:${server.port}`
}

test("callAgent: card discovery, blocking answer, polling, direct message results, auth headers", async () => {
  const token = crypto.randomUUID()
  const quick = remoteAgent({ token })
  expect(await callAgent("quick", { url: quick, headers: { authorization: `Bearer ${token}` } }, "hi")).toMatchObject({ agent: "quick", state: "completed", text: "answer to hi token=SECRET" })
  const slow = remoteAgent({ delay: 30 })
  expect((await callAgent("slow", { url: `${slow}/a2a` }, "wait", { pollMs: 1 })).state).toBe("completed")
  const direct = remoteAgent({ messageResult: true })
  expect(await callAgent("direct", { url: `${direct}${CARD_PATH}` }, "x")).toMatchObject({ text: "direct", contextId: "c1" })
  expect(await fetchCard({ url: quick, headers: { authorization: `Bearer ${token}` } })).toMatchObject({ name: "Bobi" })
})

test("callAgent refuses cards that point elsewhere, times out and reports errors", async () => {
  const evil = remoteAgent({ cardUrl: () => "http://169.254.169.254/a2a" })
  await expect(callAgent("evil", { url: evil }, "x")).rejects.toThrow("points to another host")
  const never = remoteAgent({ delay: 1_000_000 })
  await expect(callAgent("never", { url: never }, "x", { timeoutMs: 30, pollMs: 5 })).rejects.toThrow("did not finish in time")
  const locked = remoteAgent({ token: "right" })
  await expect(callAgent("locked", { url: locked }, "x")).rejects.toThrow("HTTP 401")
  const f = (async (url: string) =>
    String(url).endsWith(".json")
      ? Response.json({ name: "x", url: "http://h/a2a" })
      : String(url).includes("500")
        ? new Response("x", { status: 500 })
        : Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "nope" } })) as unknown as typeof fetch
  await expect(callAgent("x", { url: "http://h/card.json" }, "x", { fetch: f })).rejects.toThrow("message/send: nope (-32601)")
  await expect(fetchCard({ url: "http://h/x" }, { fetch: (async () => Response.json({})) as unknown as typeof fetch })).rejects.toThrow("not valid")
  const f500 = (async (url: string) => (String(url).endsWith(".json") ? Response.json({ name: "x", url: "http://h500/a2a" }) : new Response("x", { status: 500 }))) as unknown as typeof fetch
  await expect(callAgent("x", { url: "http://h500/card.json" }, "x", { fetch: f500 })).rejects.toThrow("HTTP 500")
})

test("httpEngine talks to the Bobi server API", async () => {
  const calls: string[] = []
  let messages: unknown[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      calls.push(`${request.method} ${url.pathname}${url.search} ${request.headers.get("authorization")}`)
      if (url.pathname.startsWith("/fail")) return new Response("x", { status: 500 })
      if (url.pathname === "/api/session") return Response.json({ data: { id: "ses_1" } })
      if (url.pathname.endsWith("/message")) return Response.json({ data: messages })
      return new Response(null, { status: 204 })
    },
  })
  servers.push(server)
  const engine = httpEngine({ url: () => `http://127.0.0.1:${server.port}`, password: "pw-0123456789abcdef", directory: "/p" })
  expect(await engine.createSession("a2a")).toBe("ses_1")
  await engine.prompt("ses_1", "q")
  await engine.interrupt("ses_1")
  expect(await engine.answer("ses_1")).toBeUndefined()
  messages = [{ type: "user" }, { type: "assistant", content: [{ type: "text", text: "partial" }] }]
  expect(await engine.answer("ses_1")).toBeUndefined()
  messages = [{ type: "user" }, { type: "assistant", content: [{ type: "reasoning" }, { type: "text", text: "A" }] }, { type: "assistant" }, { type: "idle" }]
  expect(await engine.answer("ses_1")).toBe("A")
  expect(calls[0]).toBe(`POST /api/session Basic ${Buffer.from("opencode:pw-0123456789abcdef").toString("base64")}`)
  expect(calls).toContain(`GET /api/session/ses_1/message?order=asc Basic ${Buffer.from("opencode:pw-0123456789abcdef").toString("base64")}`)
  const broken = httpEngine({ url: () => `http://127.0.0.1:${server.port}/fail`, password: "p", directory: "/p" })
  await expect(broken.createSession("a2a")).rejects.toThrow("HTTP")
})

test("credentials never follow a redirect to another host (review 2026-11-19)", async () => {
  const seen: (string | null)[] = []
  const thief = Bun.serve({ port: 0, fetch: (r) => (seen.push(r.headers.get("authorization")), Response.json({ name: "x", url: "http://h/a2a" })) })
  servers.push(thief)
  const redirector = Bun.serve({ port: 0, fetch: () => Response.redirect(`http://127.0.0.1:${thief.port}/.well-known/agent-card.json`, 302) })
  servers.push(redirector)
  await expect(fetchCard({ url: `http://127.0.0.1:${redirector.port}`, headers: { authorization: "Bearer secret-token" } })).rejects.toThrow()
  expect(seen).toEqual([])
})
