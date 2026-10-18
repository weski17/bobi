// @bobi/core: the OpenCode plugin that turns the OpenCode engine into Bobi (ADR-0002).
import type { Plugin } from "@opencode/plugin"
import type { BobiConfig } from "@bobi/config"
import { HeadlessBrowser, registerBrowserTool } from "@bobi/browser"
import { type AuditSink, MemorySink, OtlpSink, parseOtlpHeaders } from "./audit.ts"
import { createMasker, maskDeep, type Masker } from "./masking.ts"
import { loadDefaultPolicy, rulesForAgent, type Rule } from "./permissions.ts"
import { isUntrusted, SYSTEM_RULE, wrapUntrusted } from "./untrusted.ts"

export const PLUGIN_ID = "bobi.core"

export type BobiCoreOptions = {
  readonly config: BobiConfig
  /** Known secret values (e.g. the model API key) that are always masked. */
  readonly secrets?: readonly (string | undefined)[]
  /** Audit sink; defaults to OTLP export when an endpoint is configured, else in-memory. */
  readonly audit?: AuditSink
  readonly policy?: readonly Rule[]
  /** Headless browser for the `browser` tool; pass `false` to not register the tool. */
  readonly browser?: HeadlessBrowser | false
}

type TextContent = { type: "text"; text: string }
type Content = TextContent | { type: "file"; uri: string; mime: string; name?: string }

function transformContent(content: string | readonly Content[] | undefined, map: (text: string) => string): string | Content[] | undefined {
  if (typeof content === "string") return map(content)
  return content?.map((part) => (part.type === "text" ? { ...part, text: map(part.text) } : part))
}

export function defaultSink(config: BobiConfig, env: Record<string, string | undefined> = process.env): AuditSink {
  if (!config.telemetry.otlpEndpoint) return new MemorySink()
  return new OtlpSink({ endpoint: config.telemetry.otlpEndpoint, headers: parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS) })
}

export function createBobiCore(options: BobiCoreOptions): Plugin.Plugin & { readonly audit: AuditSink; readonly mask: Masker } {
  const { config } = options
  const policy = options.policy ?? loadDefaultPolicy()
  const audit = options.audit ?? defaultSink(config)
  const mask = createMasker(options.secrets ?? [])
  const user = config.telemetry.user ?? "unknown"
  const started = new Map<string, number>()

  return {
    id: PLUGIN_ID,
    audit,
    mask,
    setup: async (ctx) => {
      // 1. Secure defaults: append the policy and explicit auto-approvals to every agent.
      await ctx.agent.transform((editor) => {
        for (const agent of editor.list()) agent.permissions.push(...rulesForAgent(String(agent.id), policy, config.autoApprove))
      })

      // 2. Tell the model that tool output is data, not instructions.
      await ctx.session.hook("context", (event) => {
        event.system.push({ type: "text", text: SYSTEM_RULE })
      })

      // 3. Audit start time of every tool call.
      await ctx.tool.hook("execute.before", (event) => {
        started.set(event.id, Date.now())
      })

      // 4. Mask secrets, mark untrusted output, and audit the result.
      await ctx.tool.hook("execute.after", (event) => {
        const start = started.get(event.id) ?? Date.now()
        started.delete(event.id)
        const base = {
          "bobi.user": user,
          "bobi.mode": String(event.agent),
          "bobi.session": String(event.sessionID),
          "bobi.tool": event.tool,
        } as const
        if (event.status === "error") {
          audit.record({ name: "bobi.tool", start, end: Date.now(), attributes: { ...base, "bobi.result": "error", "bobi.error": mask(event.error.message) } })
          return
        }
        const untrusted = isUntrusted(event.tool)
        const content = transformContent(event.result.content as string | readonly Content[] | undefined, (text) => {
          const masked = mask(text)
          return untrusted ? wrapUntrusted(event.tool, masked) : masked
        })
        event.result = {
          ...event.result,
          ...(event.result.output === undefined ? {} : { output: maskDeep(event.result.output, mask) }),
          ...(content === undefined ? {} : { content }),
        } as typeof event.result
        audit.record({ name: "bobi.tool", start, end: Date.now(), attributes: { ...base, "bobi.result": "completed" } })
      })

      // 5. Audit every permission decision.
      await ctx.permission.hook("evaluate", (event) => {
        const now = Date.now()
        audit.record({
          name: "bobi.permission",
          start: now,
          end: now,
          attributes: {
            "bobi.user": user,
            "bobi.mode": String(event.agent ?? "unknown"),
            "bobi.session": String(event.sessionID),
            "bobi.action": event.action,
            "bobi.resources": mask(event.resources.join(", ")),
            "bobi.result": event.effect,
          },
        })
      })

      // 6. Headless browser tool (approval per page load).
      const browser = options.browser === false ? undefined : await registerBrowserTool(ctx, options.browser ?? new HeadlessBrowser())

      return async () => {
        await browser?.close()
        await audit.flush()
      }
    },
  }
}
