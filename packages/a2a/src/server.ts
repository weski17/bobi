// Inbound A2A (requirement 20): other agents send tasks to Bobi over JSON-RPC (message/send, tasks/get,
// tasks/cancel). Each task runs in a Bobi session with the read-only "a2a" agent, enforced by @bobi/core.
// One context (contextId) is one session, so follow-up questions keep their history.
import { randomUUID } from "node:crypto"
import { ERRORS, TERMINAL_STATES, textOf, type Message, type RpcRequest, type RpcResponse, type Task, type TaskState } from "./protocol.ts"

/** The parts of the Bobi server API the handler needs (implemented over HTTP by `httpEngine`). */
export interface Engine {
  createSession(agent: string): Promise<string>
  prompt(sessionID: string, text: string): Promise<void>
  /** The answer to the latest prompt once the session is idle; undefined while it is still working. */
  answer(sessionID: string): Promise<string | undefined>
  interrupt(sessionID: string): Promise<void>
}

export type InboundOptions = {
  readonly engine: Engine
  /** Engine agent for A2A sessions (the read-only agent of @bobi/core). */
  readonly agent: string
  /** How long message/send waits for the answer when blocking (default 120 s); then the task stays "working". */
  readonly waitMs?: number
  readonly pollMs?: number
  /** At most this many tasks run at the same time (default 4). */
  readonly maxWorking?: number
  /** Masks secrets in answers (defense in depth; tool output is masked already). */
  readonly mask?: (text: string) => string
}

const now = () => new Date().toISOString()
const MAX_TEXT = 100_000
const MAX_TASKS = 500

export class InboundA2a {
  private readonly tasks = new Map<string, Task & { sessionID: string; done: Promise<void> }>()
  private readonly contexts = new Map<string, string>()

  constructor(private readonly options: InboundOptions) {}

  private working() {
    return [...this.tasks.values()].filter((t) => !TERMINAL_STATES.includes(t.status.state)).length
  }

  private public(task: Task & { sessionID?: string; done?: Promise<void> }): Task {
    const { sessionID: _s, done: _d, ...visible } = task
    return structuredClone(visible)
  }

  private finish(task: Task, state: TaskState, text?: string) {
    if (TERMINAL_STATES.includes(task.status.state)) return
    const message: Message | undefined = text === undefined ? undefined : { kind: "message", role: "agent", parts: [{ kind: "text", text }], messageId: randomUUID(), contextId: task.contextId, taskId: task.id }
    task.status = { state, timestamp: now(), ...(message ? { message } : {}) }
    if (state === "completed" && text !== undefined) task.artifacts = [{ artifactId: randomUUID(), name: "answer", parts: [{ kind: "text", text }] }]
  }

  private async run(task: Task & { sessionID: string }, text: string) {
    const { engine } = this.options
    try {
      await engine.prompt(task.sessionID, text)
      while (!TERMINAL_STATES.includes(task.status.state)) {
        const answer = await engine.answer(task.sessionID)
        if (answer !== undefined) {
          const masked = (this.options.mask ?? ((t) => t))(answer.slice(0, MAX_TEXT))
          this.finish(task, "completed", masked)
          return
        }
        await new Promise((r) => setTimeout(r, this.options.pollMs ?? 250))
      }
    } catch (error) {
      this.finish(task, "failed", `Bobi could not process the task: ${(error as Error).message}`)
    }
  }

  private async send(params: unknown): Promise<Task> {
    const p = params as { message?: Message; configuration?: { blocking?: boolean } } | undefined
    const message = p?.message
    if (!message || typeof message !== "object" || !Array.isArray(message.parts) || message.role !== "user") throw rpcError(ERRORS.invalidParams, "params.message with role user and parts is required")
    const text = textOf(message.parts).trim()
    if (!text) throw rpcError(ERRORS.contentType, "only text parts are supported")
    if (message.taskId && !this.tasks.has(message.taskId)) throw rpcError(ERRORS.taskNotFound, `task ${message.taskId} not found`)
    if (this.working() >= (this.options.maxWorking ?? 4)) throw rpcError(ERRORS.internal, "too many tasks in progress; retry later")

    const contextId = typeof message.contextId === "string" && this.contexts.has(message.contextId) ? message.contextId : randomUUID()
    const sessionID = this.contexts.get(contextId) ?? (await this.options.engine.createSession(this.options.agent))
    this.contexts.set(contextId, sessionID)
    const task = { kind: "task" as const, id: randomUUID(), contextId, sessionID, status: { state: "working" as TaskState, timestamp: now() }, history: [{ ...message, contextId }], done: Promise.resolve() }
    task.done = this.run(task, text)
    this.tasks.set(task.id, task)
    this.prune()
    if (p?.configuration?.blocking !== false) await Promise.race([task.done, new Promise((r) => setTimeout(r, this.options.waitMs ?? 120_000))])
    return this.public(task)
  }

  private prune() {
    for (const [id, task] of this.tasks) {
      if (this.tasks.size <= MAX_TASKS) return
      if (TERMINAL_STATES.includes(task.status.state)) this.tasks.delete(id)
    }
  }

  private get(params: unknown): Task {
    const id = (params as { id?: unknown } | undefined)?.id
    const task = typeof id === "string" ? this.tasks.get(id) : undefined
    if (!task) throw rpcError(ERRORS.taskNotFound, `task ${String(id)} not found`)
    return this.public(task)
  }

  private async cancel(params: unknown): Promise<Task> {
    const id = (params as { id?: unknown } | undefined)?.id
    const task = typeof id === "string" ? this.tasks.get(id) : undefined
    if (!task) throw rpcError(ERRORS.taskNotFound, `task ${String(id)} not found`)
    if (TERMINAL_STATES.includes(task.status.state)) throw rpcError(ERRORS.taskNotCancelable, `task ${task.id} is already ${task.status.state}`)
    this.finish(task, "canceled")
    await this.options.engine.interrupt(task.sessionID).catch(() => {})
    return this.public(task)
  }

  /** Handles one JSON-RPC request object. */
  async rpc(request: RpcRequest): Promise<RpcResponse> {
    const id = request && typeof request === "object" && "id" in request ? request.id : null
    try {
      if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") throw rpcError(ERRORS.invalidRequest, "not a JSON-RPC 2.0 request")
      switch (request.method) {
        case "message/send":
          return { jsonrpc: "2.0", id, result: await this.send(request.params) }
        case "tasks/get":
          return { jsonrpc: "2.0", id, result: this.get(request.params) }
        case "tasks/cancel":
          return { jsonrpc: "2.0", id, result: await this.cancel(request.params) }
        case "message/stream":
        case "tasks/resubscribe":
          throw rpcError(ERRORS.unsupported, "streaming is not supported; use message/send and tasks/get")
        case "tasks/pushNotificationConfig/set":
        case "tasks/pushNotificationConfig/get":
        case "tasks/pushNotificationConfig/list":
        case "tasks/pushNotificationConfig/delete":
          throw rpcError(ERRORS.pushNotSupported, "push notifications are not supported")
        default:
          throw rpcError(ERRORS.methodNotFound, `unknown method ${request.method}`)
      }
    } catch (error) {
      const e = error as RpcError
      return { jsonrpc: "2.0", id, error: { code: typeof e.code === "number" ? e.code : ERRORS.internal, message: e.message } }
    }
  }

  /** HTTP entry point: POST with a JSON-RPC body. */
  async handle(request: Request): Promise<Response> {
    if (request.method !== "POST") return Response.json({ jsonrpc: "2.0", id: null, error: { code: ERRORS.invalidRequest, message: "use POST" } }, { status: 405 })
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: ERRORS.parse, message: "invalid JSON" } })
    }
    return Response.json(await this.rpc(body as RpcRequest))
  }
}

type RpcError = Error & { code: number }
const rpcError = (code: number, message: string): RpcError => Object.assign(new Error(message), { code })

type ApiMessage = { type: string; content?: { type: string; text?: string }[] }

/** Engine over the Bobi server's own HTTP API (same password as every client). */
export function httpEngine(options: { url: () => string; password: string; directory: string; fetch?: typeof fetch }): Engine {
  const auth = `Basic ${Buffer.from(`opencode:${options.password}`).toString("base64")}`
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const response = await (options.fetch ?? fetch)(`${options.url()}${path}`, {
      method,
      headers: { authorization: auth, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}`)
    if (!text) return undefined as T
    const parsed = JSON.parse(text) as { data?: T } | T
    return (parsed && typeof parsed === "object" && "data" in parsed ? parsed.data : parsed) as T
  }
  return {
    createSession: async (agent) => (await call<{ id: string }>("POST", "/api/session", { location: { directory: options.directory }, agent })).id,
    prompt: async (sessionID, text) => void (await call("POST", `/api/session/${encodeURIComponent(sessionID)}/prompt`, { text })),
    interrupt: async (sessionID) => void (await call("POST", `/api/session/${encodeURIComponent(sessionID)}/interrupt`, {})),
    answer: async (sessionID) => {
      const messages = await call<ApiMessage[]>("GET", `/api/session/${encodeURIComponent(sessionID)}/message?order=asc`)
      const lastUser = messages.map((m) => m.type).lastIndexOf("user")
      const after = messages.slice(lastUser + 1)
      if (lastUser < 0 || !after.some((m) => m.type === "idle")) return undefined
      return after
        .filter((m) => m.type === "assistant")
        .flatMap((m) => m.content ?? [])
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!)
        .join("\n")
        .trim()
    },
  }
}
