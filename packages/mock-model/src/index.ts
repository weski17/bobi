// Scriptable OpenAI-compatible chat completions server for deterministic tests. Also answers fill-in-the-middle
// text completions (POST /v1/completions with prompt + suffix), as used for autocomplete.
// Agent-loop requests (those that offer tools) consume the next scripted turn; when the
// script is empty, the fallback turn is used. Auxiliary requests without tools (e.g. session
// titles) get the auxiliary turn and never consume the script. No network beyond localhost.

export type ToolCall = { readonly name: string; readonly arguments: Record<string, unknown> }
export type Turn = { readonly text?: string; readonly toolCalls?: readonly ToolCall[] }

export type RecordedRequest = {
  readonly path: string
  readonly headers: Record<string, string>
  readonly body: ChatRequest
}

type ChatMessage = { role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string }
export type ChatRequest = {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  tools?: { type: string; function: { name: string } }[]
}

export type CompletionRequest = { model: string; prompt: string; suffix?: string; max_tokens?: number; stop?: string[]; temperature?: number }

export type MockModelOptions = {
  readonly port?: number
  readonly hostname?: string
  readonly models?: readonly string[]
  readonly script?: readonly Turn[]
  readonly fallback?: Turn | ((request: ChatRequest) => Turn)
  readonly auxiliary?: Turn
  /** Text returned for /v1/completions (default: "completion"). */
  readonly completion?: string | ((request: CompletionRequest) => string)
}

export type MockModel = {
  readonly url: string
  readonly baseURL: string
  readonly requests: readonly RecordedRequest[]
  readonly completions: readonly { readonly headers: Record<string, string>; readonly body: CompletionRequest }[]
  enqueue(...turns: Turn[]): void
  /** Drops scripted turns that were not consumed (e.g. after a rejected tool call ended the turn). */
  clear(): void
  stop(): Promise<void>
}

let counter = 0
const id = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(++counter).toString(36)}`

function completion(model: string, turn: Turn) {
  const toolCalls = (turn.toolCalls ?? []).map((call) => ({
    id: id("call"),
    type: "function" as const,
    function: { name: call.name, arguments: JSON.stringify(call.arguments) },
  }))
  return {
    id: id("chatcmpl"),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: turn.text ?? (toolCalls.length ? null : ""),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length ? "tool_calls" : "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }
}

function stream(model: string, turn: Turn) {
  const full = completion(model, turn)
  const choice = full.choices[0]!
  const base = { id: full.id, object: "chat.completion.chunk", created: full.created, model }
  const chunks: unknown[] = [{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }]
  if (turn.text) {
    for (const piece of turn.text.match(/.{1,16}/gs) ?? []) {
      chunks.push({ ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] })
    }
  }
  const calls = (choice.message as { tool_calls?: { id: string; function: { name: string; arguments: string } }[] }).tool_calls ?? []
  calls.forEach((call, index) => {
    chunks.push({
      ...base,
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index, id: call.id, type: "function", function: { name: call.function.name, arguments: call.function.arguments } }] },
          finish_reason: null,
        },
      ],
    })
  })
  chunks.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }], usage: full.usage })
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
      controller.enqueue(encoder.encode("data: [DONE]\n\n"))
      controller.close()
    },
  })
}

export function startMockModel(options: MockModelOptions = {}): MockModel {
  const queue: Turn[] = [...(options.script ?? [])]
  const requests: RecordedRequest[] = []
  const completions: { headers: Record<string, string>; body: CompletionRequest }[] = []
  const models = options.models ?? ["mock-model"]
  const fallback = options.fallback ?? { text: "ok" }

  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: options.hostname ?? "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url)
      const path = url.pathname.replace(/^\/v1/, "")
      if (request.method === "GET" && path === "/models") {
        return Response.json({ object: "list", data: models.map((m) => ({ id: m, object: "model", owned_by: "bobi-mock" })) })
      }
      if (request.method === "POST" && path === "/chat/completions") {
        const body = (await request.json()) as ChatRequest
        requests.push({ path: url.pathname, headers: Object.fromEntries(request.headers), body })
        const agentLoop = (body.tools?.length ?? 0) > 0
        const turn = agentLoop
          ? (queue.shift() ?? (typeof fallback === "function" ? fallback(body) : fallback))
          : (options.auxiliary ?? { text: "Bobi session" })
        if (body.stream) {
          return new Response(stream(body.model, turn), {
            headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
          })
        }
        return Response.json(completion(body.model, turn))
      }
      if (request.method === "POST" && path === "/completions") {
        const body = (await request.json()) as CompletionRequest
        completions.push({ headers: Object.fromEntries(request.headers), body })
        const text = typeof options.completion === "function" ? options.completion(body) : (options.completion ?? "completion")
        return Response.json({
          id: id("cmpl"),
          object: "text_completion",
          created: Math.floor(Date.now() / 1000),
          model: body.model,
          choices: [{ index: 0, text, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      }
      return Response.json({ error: { message: `not found: ${request.method} ${url.pathname}` } }, { status: 404 })
    },
  })

  const url = `http://${server.hostname}:${server.port}`
  return {
    url,
    baseURL: `${url}/v1`,
    requests,
    completions,
    enqueue: (...turns) => void queue.push(...turns),
    clear: () => void queue.splice(0),
    stop: async () => {
      await server.stop(true)
    },
  }
}
