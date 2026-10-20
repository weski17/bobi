// Agent2Agent (A2A) protocol types used by Bobi (requirement 20), after the open A2A specification
// (a2a-protocol.org, JSON-RPC 2.0 binding, protocol version 0.3). Only the parts Bobi uses: text parts, tasks.

export const PROTOCOL_VERSION = "0.3.0"
export const CARD_PATH = "/.well-known/agent-card.json"
export const RPC_PATH = "/a2a"

export type TextPart = { kind: "text"; text: string }
export type Part = TextPart | { kind: "file" | "data"; [key: string]: unknown }

export type Message = {
  kind: "message"
  role: "user" | "agent"
  parts: Part[]
  messageId: string
  contextId?: string
  taskId?: string
}

export type TaskState = "submitted" | "working" | "input-required" | "completed" | "canceled" | "failed" | "rejected" | "auth-required" | "unknown"
export const TERMINAL_STATES: readonly TaskState[] = ["completed", "canceled", "failed", "rejected"]

export type Artifact = { artifactId: string; name?: string; parts: Part[] }

export type Task = {
  kind: "task"
  id: string
  contextId: string
  status: { state: TaskState; message?: Message; timestamp: string }
  artifacts?: Artifact[]
  history?: Message[]
}

export type AgentSkill = { id: string; name: string; description: string; tags: string[]; examples?: string[]; inputModes?: string[]; outputModes?: string[] }

export type AgentCard = {
  protocolVersion: string
  name: string
  description: string
  url: string
  preferredTransport: "JSONRPC"
  version: string
  capabilities: { streaming: boolean; pushNotifications: boolean; stateTransitionHistory: boolean }
  securitySchemes: Record<string, { type: "http"; scheme: "basic" | "bearer"; description?: string }>
  security: Record<string, string[]>[]
  defaultInputModes: string[]
  defaultOutputModes: string[]
  skills: AgentSkill[]
}

/** JSON-RPC error codes (JSON-RPC 2.0 and A2A-specific). */
export const ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internal: -32603,
  taskNotFound: -32001,
  taskNotCancelable: -32002,
  pushNotSupported: -32003,
  unsupported: -32004,
  contentType: -32005,
} as const

export type RpcRequest = { jsonrpc: "2.0"; id: string | number | null; method: string; params?: unknown }
export type RpcResponse = { jsonrpc: "2.0"; id: string | number | null } & ({ result: unknown } | { error: { code: number; message: string; data?: unknown } })

export const textOf = (parts: readonly Part[] | undefined) =>
  (parts ?? [])
    .filter((p): p is TextPart => p.kind === "text" && typeof (p as TextPart).text === "string")
    .map((p) => p.text)
    .join("\n")
