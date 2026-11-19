// @bobi/core: turns the OpenCode engine into Bobi (ADR-0002, ADR-0013). Registered as a host plugin by @bobi/server.
import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Plugin } from "@opencode/plugin"
import { expandEnv, modelIds, PROVIDER_ID, TrustStore, type BobiConfig, type McpServer } from "@bobi/config"
import { A2A_TOOL, registerA2aTool, type RemoteAgent } from "@bobi/a2a"
import { HeadlessBrowser, registerBrowserTool } from "@bobi/browser"
import { BUILTIN_FILE, DEFAULT_MODE, editAllowed, editRestriction, hasGroup, hiddenTools, loadModes, modeDenyRules, modeFiles, modePrompt, parseModes, type Mode } from "@bobi/modes"
import { type AuditSink, FileSink, MemorySink, MultiSink, OtlpSink, parseOtlpHeaders } from "./audit.ts"
import { BobiIgnore, blockedShellPath, IGNORE_FILE, patchPaths } from "./bobiignore.ts"
import { brandSystemPrompt } from "./identity.ts"
import { expandTemplate, extensionDirs, readCommands, readSkills } from "./extensions.ts"
import { initPrompt } from "./init.ts"
import { resolveMcpServers } from "./mcp.ts"
import { createMasker, maskDeep, type Masker } from "./masking.ts"
import { loadDefaultPolicy, rulesForAgent, writesFile, type Rule } from "./permissions.ts"
import { collectRules, rulesPrompt } from "./rules.ts"
import { filterGlob, filterGrep, renderGlob, renderGrep } from "./search-filter.ts"
import { isUntrusted, SYSTEM_RULE, wrapUntrusted } from "./untrusted.ts"

export const PLUGIN_ID = "bobi.core"

/** Engine agents Bobi replaces with its own modes. */
const REPLACED_AGENTS = ["build"]
const EDIT_TOOLS = new Set(["edit", "write", "patch"])

/** Always ask, even with auto-approve: Bobi's own configuration (the agent must not widen its rights) and mainframe changes. */
export const PROTECTED_RULES: Rule[] = [
  { action: "edit", resource: "*/.bobi/*", effect: "ask" },
  { action: "edit", resource: ".bobi/*", effect: "ask" },
  { action: "edit", resource: `*/${IGNORE_FILE}`, effect: "ask" },
  { action: "edit", resource: IGNORE_FILE, effect: "ask" },
  // Changes on the mainframe (built-in zowe MCP server) always ask, even when zowe_* is auto-approved.
  { action: "zowe_write_dataset", resource: "*", effect: "ask" },
  { action: "zowe_submit_job", resource: "*", effect: "ask" },
  // Asking another agent sends project information out (A2A); always confirmed.
  { action: "a2a", resource: "*", effect: "ask" },
]

/**
 * Agent for requests from other agents (A2A, requirement 20): the built-in Ask mode, never overridable by a
 * project, limited to reading – everything else is denied, and nothing waits for an approval nobody can give.
 */
export const A2A_AGENT = "a2a"
const A2A_TOOLS = new Set(["read", "glob", "grep", "skill"])
const A2A_PROMPT =
  "This request comes from another agent over the A2A protocol, not from a person at this workstation. You can only " +
  "read and search the project. Answer in plain text. Do not include secrets, credentials or personal data in the answer."

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
  /** Project trust decision; default: the trust store in globalDir. */
  readonly trusted?: (project: string) => boolean
  /**
   * Config for one project (its .bobi/config.jsonc only if trusted). Lets one server serve several projects
   * with their own auto-approvals and mode models. Default: `config` for every project.
   */
  readonly projectConfig?: (project: string, trusted: boolean) => BobiConfig
  /** Built-in MCP servers for a project (e.g. the code graph); configured servers with the same name win. */
  readonly builtinMcp?: (project: string) => Record<string, McpServer>
  /** Environment for ${VAR} references in MCP configs (default process.env). */
  readonly env?: Record<string, string | undefined>
}

type TextContent = { type: "text"; text: string }
type Content = TextContent | { type: "file"; uri: string; mime: string; name?: string }

function transformContent(content: string | readonly Content[] | undefined, map: (text: string) => string): string | Content[] | undefined {
  if (typeof content === "string") return map(content)
  return content?.map((part) => (part.type === "text" ? { ...part, text: map(part.text) } : part))
}

/** OTLP export when an endpoint is configured, plus the local audit log in <globalDir>/audit unless disabled. */
export function defaultSink(config: BobiConfig, env: Record<string, string | undefined> = process.env, globalDir?: string): AuditSink {
  const sinks: AuditSink[] = []
  if (config.telemetry.otlpEndpoint) sinks.push(new OtlpSink({ endpoint: config.telemetry.otlpEndpoint, headers: parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS) }))
  if (globalDir && config.telemetry.auditLog !== false) sinks.push(new FileSink(path.join(globalDir, "audit")))
  if (sinks.length === 0) return new MemorySink()
  return sinks.length === 1 ? sinks[0]! : new MultiSink(sinks)
}

/** Title from the first line of the first user message: markdown and extra whitespace removed, at most 60 characters. */
export function localTitle(messages: readonly { role?: string; content?: unknown }[]): string | undefined {
  const first = messages.find((m) => m.role === undefined || m.role === "user")
  const content = first?.content
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : "")).join(" ")
        : ""
  const line = text
    .split("\n")
    .map((l) => l.replace(/[`*_#>]/g, "").replace(/\s+/g, " ").trim())
    .find((l) => l.length > 0)
  if (!line) return undefined
  return line.length <= 60 ? line : `${line.slice(0, 57).trimEnd()}…`
}

const DETAIL_MAX = 400

/** A short description of a tool call for the audit trail; the caller masks it. */
export function toolDetail(tool: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined
  const i = input as Record<string, unknown>
  const pick = (...keys: string[]) => keys.map((k) => i[k]).find((v): v is string => typeof v === "string" && v.length > 0)
  const text = tool === "patch" ? patchPaths(String(i.patchText ?? "")).join(", ") : pick("command", "path", "filePath", "pattern", "url", "query")
  return text ? (text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}…` : text) : undefined
}

/** The text of a prompt event, whatever shape the engine gives it; undefined when there is none. */
export function promptText(event: unknown): string | undefined {
  const e = event as { prompt?: unknown; text?: unknown; parts?: unknown } | null
  const value = e?.prompt ?? e?.text
  if (typeof value === "string") return value
  const parts = Array.isArray(value) ? value : Array.isArray(e?.parts) ? e.parts : (value as { parts?: unknown } | undefined)?.parts
  if (!Array.isArray(parts)) return typeof (value as { text?: unknown } | undefined)?.text === "string" ? (value as { text: string }).text : undefined
  const joined = parts.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join(" ").trim()
  return joined || undefined
}

/** The fields of an engine event the audit trail reads. */
type EngineEvent = { type: string; location?: { directory?: unknown }; data?: Record<string, unknown> }

const inputPath = (input: unknown): string | undefined =>
  input && typeof input === "object" && typeof (input as { path?: unknown }).path === "string" ? (input as { path: string }).path : undefined

export function createBobiCore(options: BobiCoreOptions): Plugin.Plugin & { readonly audit: AuditSink; readonly mask: Masker } {
  const policy = options.policy ?? loadDefaultPolicy()
  const mask = createMasker(options.secrets ?? [])
  const user = options.config.telemetry.user ?? "unknown"
  const team = options.config.telemetry.team
  // Who acted, on every audit record (requirement 19: usage per person and team).
  const who = { "bobi.user": user, ...(team ? { "bobi.team": team } : {}) }
  const globalDir = options.globalDir ?? process.env.BOBI_HOME ?? path.join(os.homedir(), ".bobi")
  const audit = options.audit ?? defaultSink(options.config, options.env ?? process.env, globalDir)
  const started = new Map<string, number>()

  return {
    id: PLUGIN_ID,
    audit,
    mask,
    setup: async (ctx) => {
      const project = String(ctx.location.project.directory)
      const location = String(ctx.location.directory)
      const ignored = new BobiIgnore(project)
      // Untrusted projects: their AGENTS.md, rules, modes and config are ignored (.bobiignore still applies).
      const trusted = options.trusted ? options.trusted(project) : new TrustStore(globalDir).isTrusted(project)
      const config = options.projectConfig?.(project, trusted) ?? options.config
      const loadAllModes = () => loadModes({ globalDir, project, includeProject: trusted })
      let modes: Mode[] = loadAllModes()

      // MCP servers of this project: built-in ones, then global/project config (project only if trusted).
      const mcp = resolveMcpServers({ ...options.builtinMcp?.(project), ...config.mcp.servers }, config.mcp.timeout, options.env ?? process.env)
      for (const { name, problem } of mcp) if (problem) console.error(`bobi: MCP server "${name}" disabled: ${problem}`)
      const mcpNames = mcp.map((m) => m.name)
      await ctx.mcp.transform((editor) => {
        for (const { name, server } of mcp) editor.set(name, server as Parameters<typeof editor.set>[1])
      })
      // A2A requests always get the built-in Ask mode, whatever the project or global modes define.
      const a2aMode = parseModes(readFileSync(BUILTIN_FILE, "utf8"), BUILTIN_FILE).find((m) => m.slug === "ask")!
      const modeOf = (agent: string) => (agent === A2A_AGENT ? a2aMode : modes.find((m) => m.slug === agent))

      // 1. Modes become engine agents; every agent gets the secure policy, auto-approvals, protected rules and
      //    – for modes – deny rules for every tool group the mode does not grant (appended last, so they win).
      await ctx.agent.transform((editor) => {
        for (const id of REPLACED_AGENTS) editor.remove(id)
        for (const mode of modes) {
          editor.update(mode.slug, (agent) => {
            agent.name = mode.name as unknown as typeof agent.name
            // The orchestrator chooses subagents by this description (requirement 10).
            agent.description = [mode.description, mode.whenToUse && `Use for: ${mode.whenToUse}`].filter(Boolean).join(". ") || undefined
            // Modes are also subagents, so a mode with the subtask group can delegate to them; a delegating mode
            // itself stays primary-only to avoid delegation loops.
            agent.mode = hasGroup(mode, "subtask") ? "primary" : "all"
            agent.hidden = false
          })
        }
        editor.update(A2A_AGENT, (agent) => {
          agent.name = "Bobi (A2A)" as unknown as typeof agent.name
          agent.description = "Read-only answers for other agents"
          agent.mode = "primary"
          agent.hidden = true
        })
        for (const agent of editor.list()) {
          const id = String(agent.id)
          const mode = modeOf(id)
          // No auto-approvals for other agents.
          const approvals = id === A2A_AGENT ? [] : config.autoApprove
          agent.permissions.push(...rulesForAgent(id, policy, approvals), ...PROTECTED_RULES, ...(mode ? modeDenyRules(mode, mcpNames) : []))
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
                modes = loadAllModes()
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

      // Per-mode models (CLAUDE.md: e.g. a large model for plan). The engine uses the session's model for turns,
      // so Bobi switches it when the session enters another mode; a model the user picks within a mode is kept.
      const lastAgent = new Map<string, string>()
      const sessionMode = new Map<string, string>()
      // The model a session works with, for the audit trail (usage records and the change dossier).
      const sessionModel = new Map<string, string>()
      await ctx.session.hook("prompt", async (event) => {
        const sessionID = String(event.sessionID)
        const session = await ctx.session.get({ sessionID })
        const agent = String(session.agent ?? DEFAULT_MODE)
        sessionMode.set(sessionID, agent)
        if (session.model?.id) sessionModel.set(sessionID, String(session.model.id))
        const now = Date.now()
        const prompt = promptText(event)
        audit.record({
          name: "bobi.task",
          start: now,
          end: now,
          attributes: { ...who, "bobi.mode": agent, "bobi.session": sessionID, "bobi.result": "started", ...(prompt ? { "bobi.detail": mask(prompt.length > DETAIL_MAX ? `${prompt.slice(0, DETAIL_MAX)}…` : prompt) } : {}) },
        })
        if (lastAgent.get(sessionID) === agent) return
        lastAgent.set(sessionID, agent)
        // Only models the server's endpoint config declares can be selected.
        const wanted = config.modes[agent]?.model
        const known = modelIds(options.config)
        if (wanted && !known.includes(wanted)) console.error(`bobi: model "${wanted}" for mode ${agent} is not in model.models of the server config; using ${config.model.default}`)
        const target = wanted && known.includes(wanted) ? wanted : config.model.default
        if (session.model?.id === target && String(session.model.providerID) === PROVIDER_ID) return
        await ctx.session.switchModel({ sessionID, model: { providerID: PROVIDER_ID, id: target } })
        sessionModel.set(sessionID, target)
      })

      // Session titles without a model call (sessions.titles: "local"): derived from the first message. The engine
      // otherwise asks the model once per session – on slow models that is a noticeable wait.
      if (config.sessions.titles === "local")
        await ctx.session.hook("title", (event) => {
          const title = localTitle(event.messages)
          if (title) event.result = title
        })

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
        // The a2a tool reaches outside like an MCP server: only for modes with the mcp group.
        if (!mode || !hasGroup(mode, "mcp")) delete event.tools[A2A_TOOL]
        if (String(event.agent) === A2A_AGENT) {
          event.system.push({ type: "text", text: A2A_PROMPT })
          for (const name of Object.keys(event.tools)) if (!A2A_TOOLS.has(name)) delete event.tools[name]
        }
        const rules = rulesPrompt(collectRules(mode?.slug ?? String(event.agent), { globalDir, project, location, includeProject: trusted }), project)
        if (rules) event.system.push({ type: "text", text: rules })
      })

      // 3. Before a tool runs: .bobiignore and the mode's edit restriction.
      await ctx.tool.hook("execute.before", (event) => {
        started.set(event.id, Date.now())
        if (String(event.agent) === A2A_AGENT && !A2A_TOOLS.has(event.tool)) throw new Error(`${event.tool} is not available to requests from other agents (read-only).`)
        if (event.tool === A2A_TOOL) {
          const mode = modeOf(String(event.agent))
          if (!mode || !hasGroup(mode, "mcp")) throw new Error(`The a2a tool needs a mode with the mcp group (e.g. Advanced); ${String(event.agent)} does not have it.`)
        }
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
        const detail = toolDetail(event.tool, event.input)
        const base = {
          ...who,
          "bobi.mode": String(event.agent),
          "bobi.session": String(event.sessionID),
          "bobi.tool": event.tool,
          ...(detail ? { "bobi.detail": mask(detail) } : {}),
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
        if (event.agent) sessionMode.set(String(event.sessionID), String(event.agent))
        // An explicit shell auto-approval (e.g. "git log *") never covers writing a file through a redirect.
        if (event.action === "shell" && event.effect === "allow" && event.resources.some((r) => writesFile(String(r)))) event.effect = "ask"
        // Other agents may only read; an approval request would wait for a person who is not there.
        if (String(event.agent) === A2A_AGENT && (event.effect === "ask" || !A2A_TOOLS.has(event.action))) {
          event.effect = "deny"
          event.message = "Not available to requests from other agents (read-only)."
        }
        audit.record({
          name: "bobi.permission",
          start: now,
          end: now,
          attributes: {
            ...who,
            "bobi.mode": String(event.agent ?? "unknown"),
            "bobi.session": String(event.sessionID),
            "bobi.action": event.action,
            "bobi.resources": mask(event.resources.join(", ")),
            "bobi.result": event.effect,
          },
        })
      })

      // 5b. Audit the user's answer to every approval request (once / always / reject).
      const asked = new Map<string, { action: string; resources: string; agent: string }>()
      const events = new AbortController()
      void (async () => {
        try {
          for await (const event of ctx.event.subscribe({ signal: events.signal } as never) as AsyncIterable<EngineEvent>) {
            // Setup runs once per location, and every instance's stream carries the events of all locations. Only the
            // instance of the event's location records it (once, and with the mode and model its prompt hook saw).
            if (event.location?.directory !== undefined && String(event.location.directory) !== location) continue
            const data = event.data ?? {}
            if (event.type === "permission.asked")
              asked.set(String(data.id), {
                action: String(data.action),
                resources: mask((data.resources as string[] | undefined)?.join(", ") ?? ""),
                // The request carries no mode; it is the mode of the evaluation that asked.
                agent: sessionMode.get(String(data.sessionID)) ?? "unknown",
              })
            if (event.type === "session.step.ended" || event.type === "session.step.failed") {
              const tokens = data.tokens as { input: number; output: number; reasoning: number; cache: { read: number; write: number } } | undefined
              if (!tokens) continue
              const now = Date.now()
              const sessionID = String(data.sessionID)
              audit.record({
                name: "bobi.usage",
                start: now,
                end: now,
                attributes: {
                  ...who,
                  "bobi.mode": sessionMode.get(sessionID) ?? "unknown",
                  "bobi.session": sessionID,
                  "bobi.result": "recorded",
                  ...(sessionModel.has(sessionID) ? { "bobi.model": sessionModel.get(sessionID)! } : {}),
                  "bobi.tokens.input": tokens.input,
                  "bobi.tokens.output": tokens.output,
                  "bobi.tokens.reasoning": tokens.reasoning,
                  "bobi.tokens.cache": tokens.cache.read + tokens.cache.write,
                },
              })
              continue
            }
            if (event.type !== "permission.replied") continue
            const request = asked.get(String(data.requestID))
            asked.delete(String(data.requestID))
            const now = Date.now()
            audit.record({
              name: "bobi.approval",
              start: now,
              end: now,
              attributes: {
                ...who,
                "bobi.mode": request?.agent ?? "unknown",
                "bobi.session": String(data.sessionID),
                ...(request ? { "bobi.action": request.action, "bobi.resources": request.resources } : {}),
                "bobi.result": data.reply as "once" | "always" | "reject",
              },
            })
          }
        } catch (error) {
          if (!events.signal.aborted) console.error(`bobi audit: event stream ended: ${(error as Error).message}`)
        }
      })()

      // 6. Skills and slash commands (built-in /commit, /pr, /security-review; global; project if trusted).
      const dirs = extensionDirs(globalDir, project, trusted)
      const skills = readSkills(dirs.skills)
      await ctx.skill.transform((editor) => {
        for (const skill of skills)
          editor.add({ id: skill.name, name: skill.name, description: skill.description, path: skill.path, content: skill.content } as Parameters<typeof editor.add>[0])
      })
      const commands = readCommands(dirs.commands)
      // /init with Bobi's own prompt (replaces the engine's).
      await ctx.command.transform((editor) => {
        for (const command of commands)
          editor.add({
            name: command.name,
            description: command.description,
            execute: async (input) => {
              if (command.mode && modeOf(command.mode)) await ctx.session.switchAgent({ sessionID: input.sessionID, agent: command.mode })
              await ctx.session.prompt({
                ...input.prompt,
                sessionID: input.sessionID,
                text: expandTemplate(command.template, input.prompt.text ?? ""),
                delivery: input.delivery,
              } as Parameters<typeof ctx.session.prompt>[0])
            },
          })
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

      // 7a. Remote agents (A2A); header values are ${VAR} references, agents with missing variables are skipped.
      const remote: Record<string, RemoteAgent> = {}
      for (const [name, agent] of Object.entries(config.a2a.agents)) {
        const missing: string[] = []
        const headers = Object.fromEntries(
          Object.entries(agent.headers ?? {}).map(([k, v]) => {
            const out = expandEnv(v, options.env ?? process.env)
            missing.push(...out.missing)
            return [k, out.value]
          }),
        )
        if (missing.length) console.error(`bobi: A2A agent "${name}" disabled: missing environment variable(s) ${[...new Set(missing)].join(", ")}`)
        else remote[name] = { url: agent.url, headers, ...(agent.description ? { description: agent.description } : {}) }
      }
      await registerA2aTool(ctx, remote)

      // 7. Headless browser tool (approval per page).
      const browser = options.browser === false ? undefined : await registerBrowserTool(ctx, options.browser ?? new HeadlessBrowser())

      return async () => {
        events.abort()
        for (const w of watchers) w.close()
        await browser?.close()
        await audit.flush()
      }
    },
  }
}
