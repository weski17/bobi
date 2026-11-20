// The agent card other agents discover at /.well-known/agent-card.json (requirement 20).
import { PROTOCOL_VERSION, RPC_PATH, type AgentCard } from "./protocol.ts"

export function agentCard(options: { baseUrl: string; version: string; name?: string; description?: string }): AgentCard {
  return {
    protocolVersion: PROTOCOL_VERSION,
    name: options.name ?? "Bobi",
    description:
      options.description ??
      "On-premise development partner. Answers questions about the code of this project (read-only: it does not change files or run commands for other agents).",
    url: `${options.baseUrl.replace(/\/$/, "")}${RPC_PATH}`,
    preferredTransport: "JSONRPC",
    version: options.version,
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "The A2A token of this Bobi server (BOBI_A2A_TOKEN); it is valid only for this endpoint" } },
    security: [{ bearer: [] }],
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "code-questions",
        name: "Questions about the code",
        description: "Explains how the project works, where something is implemented and what a change would affect, with file references.",
        tags: ["code", "explain", "search", "read-only"],
        examples: ["Where is the login validated?", "Which programs use the copybook CVACT01Y?"],
      },
    ],
  }
}
