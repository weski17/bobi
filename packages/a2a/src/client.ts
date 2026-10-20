// Outbound A2A (requirement 20): Bobi asks another agent. Only agents listed in the Bobi config can be called;
// credentials come from environment variables (${VAR} in the headers, like MCP servers).
import { randomUUID } from "node:crypto"
import { CARD_PATH, TERMINAL_STATES, textOf, type AgentCard, type Message, type RpcResponse, type Task } from "./protocol.ts"

export type RemoteAgent = { readonly url: string; readonly headers?: Record<string, string>; readonly description?: string }

export type CallOptions = {
  readonly contextId?: string
  readonly fetch?: typeof fetch
  /** Overall time limit (default 120 s). */
  readonly timeoutMs?: number
  readonly pollMs?: number
}

export type CallResult = { readonly text: string; readonly state: string; readonly taskId?: string; readonly contextId?: string; readonly agent: string }

export class A2aError extends Error {}

/** Reads the agent card: either the given URL is the card, or the card is at <origin>/.well-known/agent-card.json. */
export async function fetchCard(agent: RemoteAgent, options: Pick<CallOptions, "fetch"> = {}): Promise<AgentCard> {
  const url = agent.url.endsWith(".json") ? agent.url : `${new URL(agent.url).origin}${CARD_PATH}`
  const response = await (options.fetch ?? fetch)(url, { headers: { ...agent.headers }, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new A2aError(`agent card ${url}: HTTP ${response.status}`)
  const card = (await response.json()) as AgentCard
  if (typeof card.url !== "string" || typeof card.name !== "string") throw new A2aError(`agent card ${url} is not valid`)
  return card
}

async function rpc(endpoint: string, agent: RemoteAgent, method: string, params: unknown, f: typeof fetch): Promise<unknown> {
  const response = await f(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", ...agent.headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: randomUUID(), method, params }),
    signal: AbortSignal.timeout(130_000),
  })
  if (!response.ok) throw new A2aError(`${method}: HTTP ${response.status}`)
  const body = (await response.json()) as RpcResponse
  if ("error" in body) throw new A2aError(`${method}: ${body.error.message} (${body.error.code})`)
  return body.result
}

/** Sends one text message and waits for the task to finish; returns the agent's text answer. */
export async function callAgent(name: string, agent: RemoteAgent, text: string, options: CallOptions = {}): Promise<CallResult> {
  const f = options.fetch ?? fetch
  const card = await fetchCard(agent, options)
  // The card's endpoint must stay on the configured origin: a card cannot redirect Bobi to other hosts.
  if (new URL(card.url).origin !== new URL(agent.url).origin) throw new A2aError(`agent card of ${name} points to another host (${new URL(card.url).origin})`)
  const message: Message = { kind: "message", role: "user", parts: [{ kind: "text", text }], messageId: randomUUID(), ...(options.contextId ? { contextId: options.contextId } : {}) }
  let result = (await rpc(card.url, agent, "message/send", { message, configuration: { blocking: true, acceptedOutputModes: ["text/plain"] } }, f)) as Task | Message
  if (result.kind === "message") return { text: textOf(result.parts), state: "completed", agent: name, ...(result.contextId ? { contextId: result.contextId } : {}) }
  const deadline = Date.now() + (options.timeoutMs ?? 120_000)
  while (!TERMINAL_STATES.includes(result.status.state) && result.status.state !== "input-required" && result.status.state !== "auth-required") {
    if (Date.now() > deadline) {
      await rpc(card.url, agent, "tasks/cancel", { id: result.id }, f).catch(() => {})
      throw new A2aError(`${name} did not finish in time (task ${result.id})`)
    }
    await new Promise((r) => setTimeout(r, options.pollMs ?? 1000))
    result = (await rpc(card.url, agent, "tasks/get", { id: result.id }, f)) as Task
  }
  const answer = [textOf(result.artifacts?.flatMap((a) => a.parts)), textOf(result.status.message?.parts)].find((t) => t.trim()) ?? ""
  return { text: answer, state: result.status.state, taskId: result.id, contextId: result.contextId, agent: name }
}
