// @bobi/core: turns the OpenCode engine into Bobi (ADR-0002, ADR-0013). Registered as a host plugin by @bobi/server.
import { existsSync, watch, type FSWatcher } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Plugin } from "@opencode/plugin"
import type { BobiConfig } from "@bobi/config"
import { HeadlessBrowser, registerBrowserTool } from "@bobi/browser"
import { DEFAULT_MODE, editAllowed, editRestriction, hiddenTools, loadModes, modeDenyRules, modeFiles, modePrompt, type Mode } from "@bobi/modes"
import { type AuditSink, MemorySink, OtlpSink, parseOtlpHeaders } from "./audit.ts"
import { BobiIgnore, blockedShellPath, IGNORE_FILE, patchPaths } from "./bobiignore.ts"
import { brandSystemPrompt } from "./identity.ts"
import { initPrompt } from "./init.ts"
import { createMasker, maskDeep, type Masker } from "./masking.ts"
import { loadDefaultPolicy, rulesForAgent, type Rule } from "./permissions.ts"
import { collectRules, rulesPrompt } from "./rules.ts"
import { filterGlob, filterGrep, renderGlob, renderGrep } from "./search-filter.ts"
import { isUntrusted, SYSTEM_RULE, wrapUntrusted } from "./untrusted.ts"

export const PLUGIN_ID = "bobi.core"

/** Engine agents Bobi replaces with its own modes. */
const REPLACED_AGENTS = ["build"]
const EDIT_TOOLS = new Set(["edit", "write", "patch"])

/** Changes to Bobi's own configuration always ask, even with auto-approve (the agent must not widen its rights). */
export const PROTECTED_RULES: Rule[] = [
  { action: "edit", resource: "*/.bobi/*", effect: "ask" },
  { action: "edit", resource: ".bobi/*", effect: "ask" },
  { action: "edit", resource: `*/${IGNORE_FILE}`, effect: "ask" },
  { action: "edit", resource: IGNORE_FILE, effect: "ask" },
]

export type BobiCoreOptions = {
  readonly config: BobiConfig
  /** Known secret values (e.g. the model API key) that are always masked. */
  readonly secrets?: readonly (string | undefined)[]
  /** Audit sink; defaults to OTLP export when an endpoint is configured, else in-memory. */
  readonly audit?: AuditSink
  readonly policy?: readonly Rule[]
  /** Headless browser for the `browser` tool; pass `false` to not register the tool. */
  readonly browser?: HeadlessBrowser | false
  /** BOBI_HOME: global custom_modes.yaml and rules (default ~/.bobi). */
  readonly globalDir?: string
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

const inputPath = (input: unknown): string | undefined =>
  input && typeof input === "object" && typeof (input as { path?: unknown }).path === "string" ? (input as { path: string }).path : undefined

export function createBobiCore(options: BobiCoreOptions): Plugin.Plugin & { readonly audit: AuditSink; readonly mask: Masker } {
  const { config } = options
  const policy = options.policy ?? loadDefaultPolicy()
  const audit = options.audit ?? defaultSink(config)
  const mask = createMasker(options.secrets ?? [])
  const user = config.telemetry.user ?? "unknown"
  const globalDir = options.globalDir ?? process.env.BOBI_HOME ?? path.join(os.homedir(), ".bobi")
  const started = new Map<string, number>()

  return {
    id: PLUGIN_ID,
    audit,
    mask,
    setup: async (ctx) => {
      const project = String(ctx.location.project.directory)
      const location = String(ctx.location.directory)
      const ignored = new BobiIgnore(project)
      let modes: Mode[] = loadModes({ globalDir, project })
      const modeOf = (agent: string) => modes.find((m) => m.slug === agent)

      // 1. Modes become engine agents; every agent gets the secure policy, auto-approvals, protected rules and
      //    – for modes – deny rules for every tool group the mode does not grant (appended last, so they win).
      await ctx.agent.transform((editor) => {
        for (const id of REPLACED_AGENTS) editor.remove(id)
        for (const mode of modes) {
          editor.update(mode.slug, (agent) => {
            agent.name = mode.name as unknown as typeof agent.name
            agent.description = mode.description ?? mode.whenToUse
            agent.mode = "primary"
            agent.hidden = false
          })
        }
        for (const agent of editor.list()) {
          const id = String(agent.id)
          const mode = modeOf(id)
          agent.permissions.push(...rulesForAgent(id, policy, config.autoApprove), ...PROTECTED_RULES, ...(mode ? modeDenyRules(mode) : []))
        }
        if (modeOf(DEFAULT_MODE)) editor.default(DEFAULT_MODE)
      })

      // Reload modes when a custom_modes.yaml changes (project or global).
      const watchers: FSWatcher[] = []
      for (const file of modeFiles({ globalDir, project })) {
        const dir = path.dirname(file)
        if (!existsSync(dir)) continue
        try {
          watchers.push(
            watch(dir, (_event, name) => {
              if (name !== path.basename(file)) return
              try {
                modes = loadModes({ globalDir, project })
                void ctx.agent.reload()
              } catch (error) {
                console.error(`bobi: ${(error as Error).message}`)
              }
            }),
          )
        } catch {
          // Watching is a convenience; modes still load on the next start.
        }
      }

      // 2. System prompt: Bobi identity, untrusted-data rule, mode role, project rules; hide tools the mode lacks.
      await ctx.session.hook("context", (event) => {
        const first = event.system[0]
        if (first) event.system[0] = { ...first, text: brandSystemPrompt(first.text) }
        else event.system.unshift({ type: "text", text: brandSystemPrompt("") })
        event.system.push({ type: "text", text: SYSTEM_RULE })
        const mode = modeOf(String(event.agent))
        if (mode) {
          event.system.push({ type: "text", text: modePrompt(mode) })
          for (const name of hiddenTools(mode, Object.keys(event.tools))) delete event.tools[name]
        }
        const rules = rulesPrompt(collectRules(mode?.slug ?? String(event.agent), { globalDir, project, location }), project)
        if (rules) event.system.push({ type: "text", text: rules })
      })

      // 3. Before a tool runs: .bobiignore and the mode's edit restriction.
      await ctx.tool.hook("execute.before", (event) => {
        started.set(event.id, Date.now())
        const target = inputPath(event.input)
        const paths =
          event.tool === "patch" ? patchPaths(String((event.input as { patchText?: unknown })?.patchText ?? "")) : target ? [target] : []
        if (["read", "write", "edit", "patch", "grep", "glob"].includes(event.tool)) {
          const blocked = paths.find((p) => ignored.ignores(path.resolve(location, p)))
          if (blocked) throw new Error(ignored.message(path.resolve(location, blocked)))
        }
        if (event.tool === "shell") {
          const input = event.input as { command?: unknown; workdir?: unknown }
          const cwd = typeof input.workdir === "string" ? path.resolve(location, input.workdir) : location
          const blocked = typeof input.command === "string" ? blockedShellPath(input.command, cwd, ignored) : undefined
          if (blocked) throw new Error(ignored.message(path.resolve(cwd, blocked)))
        }
        const mode = modeOf(String(event.agent))
        if (mode && EDIT_TOOLS.has(event.tool) && editRestriction(mode)) {
          for (const p of paths) {
            const relative = path.relative(project, path.resolve(location, p))
            if (!editAllowed(mode, relative))
              throw new Error(`${mode.name} mode may only edit files matching ${editRestriction(mode)!.fileRegex}; ${relative} is not allowed. Ask the user to switch to Code mode.`)
          }
        }
      })

      // 4. After a tool ran: hide ignored search results, mask secrets, mark untrusted output, audit.
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
        let result = event.result
        const searchBase = path.resolve(location, inputPath(event.input) ?? ".")
        if (event.tool === "glob" && Array.isArray(result.output)) {
          const { entries, removed } = filterGlob(result.output as { path: string }[], searchBase, ignored)
          if (removed) result = { ...result, output: entries as never, content: renderGlob(entries, removed) }
        }
        if (event.tool === "grep" && Array.isArray(result.output)) {
          const { matches, removed } = filterGrep(result.output as { entry: { path: string }; line: number; text: string }[], searchBase, ignored)
          if (removed) result = { ...result, output: matches as never, content: renderGrep(matches, removed) }
        }
        const untrusted = isUntrusted(event.tool)
        const content = transformContent(result.content as string | readonly Content[] | undefined, (text) => {
          const masked = mask(text)
          return untrusted ? wrapUntrusted(event.tool, masked) : masked
        })
        event.result = {
          ...result,
          ...(result.output === undefined ? {} : { output: maskDeep(result.output, mask) }),
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

      // 6. /init with Bobi's own prompt (replaces the engine's).
      await ctx.command.transform((editor) => {
        editor.add({
          name: "init",
          description: "create or update AGENTS.md for this project",
          execute: async (input) => {
            await ctx.session.prompt({
              ...input.prompt,
              sessionID: input.sessionID,
              text: initPrompt(project, input.prompt.text ?? ""),
              delivery: input.delivery,
            } as Parameters<typeof ctx.session.prompt>[0])
          },
        })
      })

      // 7. Headless browser tool (approval per page).
      const browser = options.browser === false ? undefined : await registerBrowserTool(ctx, options.browser ?? new HeadlessBrowser())

      return async () => {
        for (const w of watchers) w.close()
        await browser?.close()
        await audit.flush()
      }
    },
  }
}
