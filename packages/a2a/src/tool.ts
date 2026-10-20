// The `a2a` tool: lets a mode with the mcp group ask a configured remote agent. Every call asks the user
// (action "a2a", resource = agent name); the answer is untrusted data like any tool output.
import type { Plugin } from "@opencode/plugin"
import { Schema } from "effect"
import { callAgent, type CallOptions, type RemoteAgent } from "./client.ts"

type Context = Parameters<Plugin.Plugin["setup"]>[0]

export const A2A_TOOL = "a2a"

const Input = Schema.Struct({
  agent: Schema.String.annotate({ description: "Name of a configured agent" }),
  message: Schema.String.annotate({ description: "The question or task for the other agent" }),
  contextId: Schema.optional(Schema.String).annotate({ description: "Continue an earlier conversation with this agent" }),
})

const Output = Schema.Struct({ agent: Schema.String, state: Schema.String, text: Schema.String, contextId: Schema.optional(Schema.String) })

export async function registerA2aTool(ctx: Context, agents: Record<string, RemoteAgent>, options: Omit<CallOptions, "contextId"> = {}) {
  const names = Object.keys(agents)
  if (names.length === 0) return
  const list = names.map((n) => `${n}${agents[n]!.description ? ` (${agents[n]!.description})` : ""}`).join(", ")
  await ctx.tool.transform((tools) => {
    tools.add({
      name: A2A_TOOL,
      description: `Ask another agent over the A2A protocol and return its answer. Configured agents: ${list}. Each call asks the user for approval.`,
      input: Input,
      output: Output,
      options: { codemode: false },
      execute: async ({ agent, message, contextId }, context) => {
        const target = agents[agent]
        if (!target) throw new Error(`Unknown agent "${agent}". Configured agents: ${names.join(", ")}`)
        await ctx.permission.assert({
          sessionID: context.sessionID,
          agent: context.agent,
          action: A2A_TOOL,
          resources: [agent],
          save: [agent],
          source: { type: "tool", messageID: context.messageID, id: context.id },
        })
        const result = await callAgent(agent, target, message, { ...options, ...(contextId ? { contextId } : {}) })
        return {
          output: { agent, state: result.state, text: result.text, ...(result.contextId ? { contextId: result.contextId } : {}) },
          content: `Answer from ${agent} (${result.state}${result.contextId ? `, contextId ${result.contextId}` : ""}):\n${result.text}`,
        }
      },
    })
  })
}
