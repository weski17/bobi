// Bobi configuration schema. Hand-written validation keeps this package dependency-free.
// Secrets are never accepted from files: API keys come from environment variables only.

export type Protocol = "openai" | "anthropic"
export type ApprovalAction = "edit" | "shell" | "webfetch" | "browser" | "mcp" | "external_directory"

export const APPROVAL_ACTIONS: readonly ApprovalAction[] = ["edit", "shell", "webfetch", "browser", "mcp", "external_directory"]

export type ModelEndpoint = {
  /** OpenAI- or Anthropic-compatible base URL, e.g. a LiteLLM gateway. */
  baseURL: string
  protocol: Protocol
  /** Name of the environment variable holding the API key. */
  apiKeyEnv: string
  /** Default model id served by the endpoint. */
  default: string
  /** Additional model ids that modes may select. */
  models: string[]
}

export type AutoApproveRule = {
  action: ApprovalAction
  /** Glob over the tool resource (file path, shell command, URL, MCP tool name). */
  resource: string
  /** Restrict the rule to these modes; empty means all modes. */
  modes: string[]
}

/** MCP servers (requirement 8). Secret values only as ${ENV_VAR} references. */
export type McpLocalServer = { type: "local"; command: string[]; env?: Record<string, string>; cwd?: string; enabled?: boolean }
export type McpRemoteServer = { type: "remote"; url: string; headers?: Record<string, string>; enabled?: boolean }
export type McpServer = McpLocalServer | McpRemoteServer
export type McpConfig = { servers: Record<string, McpServer>; timeout?: { startup?: number; execution?: number } }

export type BobiConfig = {
  model: ModelEndpoint
  /** Per-mode model selection: mode slug → model id. */
  modes: Record<string, { model?: string }>
  /** Explicit auto-approvals. Default: every write, shell command and network action asks. */
  autoApprove: AutoApproveRule[]
  /** OTLP export endpoint, the user recorded in audit records, and the local audit log (default on). */
  telemetry: { otlpEndpoint?: string; user?: string; team?: string; auditLog?: boolean }
  checkpoints: { enabled: boolean }
  mcp: McpConfig
  /** Inline code completion in the IDE (requirement 17). Off until a model is set. */
  autocomplete: { model?: string; maxTokens?: number }
  /**
   * A2A (requirement 20). `enabled`: other agents may send read-only tasks to this server (global config or
   * BOBI_A2A=1 only, never a project). `agents`: remote agents Bobi may call; credentials only as ${ENV_VAR}.
   */
  a2a: { enabled: boolean; agents: Record<string, A2aAgent> }
  /**
   * Usage report (requirement 19). Time saved cannot be measured; it is shown only when these estimates are set
   * (minutes per finished task and per approved change) and is labelled as an estimate.
   */
  usage: { minutesPerTask?: number; minutesPerAcceptedChange?: number }
  /**
   * How sessions get their title: "model" asks the model after the first message (an extra request per session),
   * "local" derives it from the first message without a model call (saves time on slow models and tokens).
   */
  sessions: { titles: "model" | "local" }
  /** Code tips while editing (requirement 14): local analysis, thresholds per project. */
  tips: { enabled?: boolean; complexity?: number; functionLines?: number; nesting?: number; parameters?: number }
}

export type A2aAgent = { url: string; headers?: Record<string, string>; description?: string }

export const DEFAULTS: BobiConfig = {
  model: {
    baseURL: "http://localhost:4000/v1",
    protocol: "openai",
    apiKeyEnv: "BOBI_MODEL_API_KEY",
    default: "default",
    models: [],
  },
  modes: {},
  autoApprove: [],
  telemetry: {},
  checkpoints: { enabled: true },
  mcp: { servers: {} },
  autocomplete: {},
  a2a: { enabled: false, agents: {} },
  usage: {},
  sessions: { titles: "model" },
  tips: {},
}

export class ConfigError extends Error {
  constructor(
    readonly source: string,
    readonly issues: readonly string[],
  ) {
    super(`Invalid Bobi config (${source}):\n${issues.map((i) => `  - ${i}`).join("\n")}`)
    this.name = "ConfigError"
  }
}

const FORBIDDEN_SECRET_KEYS = ["apiKey", "api_key", "token", "password", "secret"]
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

function findSecrets(value: unknown, at: string, out: string[]) {
  if (Array.isArray(value)) value.forEach((v, i) => findSecrets(v, `${at}[${i}]`, out))
  if (!isObject(value)) return
  for (const [key, v] of Object.entries(value)) {
    const where = at ? `${at}.${key}` : key
    if (FORBIDDEN_SECRET_KEYS.includes(key)) out.push(`${where}: secrets are not allowed in config files; set the value via an environment variable`)
    findSecrets(v, where, out)
  }
}

/** Validates one partial config document (as read from a file) and returns it typed. */
export function validatePartial(input: unknown, source: string): DeepPartial<BobiConfig> {
  const issues: string[] = []
  if (!isObject(input)) throw new ConfigError(source, ["config must be a JSON object"])
  findSecrets(input, "", issues)

  const known = new Set(["$schema", "model", "modes", "autoApprove", "telemetry", "checkpoints", "mcp", "autocomplete", "a2a", "usage", "tips", "sessions"])
  for (const key of Object.keys(input)) if (!known.has(key)) issues.push(`${key}: unknown key`)

  const model = input.model
  if (model !== undefined) {
    if (!isObject(model)) issues.push("model: must be an object")
    else {
      if (model.baseURL !== undefined && (typeof model.baseURL !== "string" || !/^https?:\/\//.test(model.baseURL)))
        issues.push("model.baseURL: must be an http(s) URL")
      if (model.protocol !== undefined && model.protocol !== "openai" && model.protocol !== "anthropic")
        issues.push('model.protocol: must be "openai" or "anthropic"')
      if (model.apiKeyEnv !== undefined && (typeof model.apiKeyEnv !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(model.apiKeyEnv)))
        issues.push("model.apiKeyEnv: must be an environment variable name")
      if (model.default !== undefined && (typeof model.default !== "string" || model.default === ""))
        issues.push("model.default: must be a non-empty string")
      if (model.models !== undefined && (!Array.isArray(model.models) || model.models.some((m) => typeof m !== "string")))
        issues.push("model.models: must be an array of strings")
    }
  }

  if (input.modes !== undefined) {
    if (!isObject(input.modes)) issues.push("modes: must be an object")
    else
      for (const [slug, mode] of Object.entries(input.modes)) {
        if (!/^[a-z][a-z0-9-]*$/.test(slug)) issues.push(`modes.${slug}: slug must be lowercase letters, digits and dashes`)
        if (!isObject(mode)) issues.push(`modes.${slug}: must be an object`)
        else if (mode.model !== undefined && typeof mode.model !== "string") issues.push(`modes.${slug}.model: must be a string`)
      }
  }

  if (input.autoApprove !== undefined) {
    if (!Array.isArray(input.autoApprove)) issues.push("autoApprove: must be an array")
    else
      input.autoApprove.forEach((rule, i) => {
        if (!isObject(rule)) return void issues.push(`autoApprove[${i}]: must be an object`)
        if (!APPROVAL_ACTIONS.includes(rule.action as ApprovalAction))
          issues.push(`autoApprove[${i}].action: must be one of ${APPROVAL_ACTIONS.join(", ")}`)
        if (typeof rule.resource !== "string" || rule.resource === "") issues.push(`autoApprove[${i}].resource: must be a non-empty glob`)
        if (rule.modes !== undefined && (!Array.isArray(rule.modes) || rule.modes.some((m) => typeof m !== "string")))
          issues.push(`autoApprove[${i}].modes: must be an array of mode slugs`)
      })
  }

  if (input.telemetry !== undefined) {
    if (!isObject(input.telemetry)) issues.push("telemetry: must be an object")
    else {
      const t = input.telemetry
      if (t.otlpEndpoint !== undefined && (typeof t.otlpEndpoint !== "string" || !/^https?:\/\//.test(t.otlpEndpoint)))
        issues.push("telemetry.otlpEndpoint: must be an http(s) URL")
      if (t.user !== undefined && typeof t.user !== "string") issues.push("telemetry.user: must be a string")
      if (t.auditLog !== undefined && typeof t.auditLog !== "boolean") issues.push("telemetry.auditLog: must be a boolean")
      if (t.team !== undefined && (typeof t.team !== "string" || t.team === "")) issues.push("telemetry.team: must be a non-empty string")
    }
  }

  if (input.checkpoints !== undefined) {
    if (!isObject(input.checkpoints) || (input.checkpoints.enabled !== undefined && typeof input.checkpoints.enabled !== "boolean"))
      issues.push("checkpoints.enabled: must be a boolean")
  }

  if (input.mcp !== undefined) validateMcp(input.mcp, issues)

  if (input.autocomplete !== undefined) {
    const a = input.autocomplete
    if (!isObject(a)) issues.push("autocomplete: must be an object")
    else {
      for (const key of Object.keys(a)) if (key !== "model" && key !== "maxTokens") issues.push(`autocomplete.${key}: unknown key`)
      if (a.model !== undefined && (typeof a.model !== "string" || a.model === "")) issues.push("autocomplete.model: must be a non-empty string")
      if (a.maxTokens !== undefined && (typeof a.maxTokens !== "number" || !Number.isInteger(a.maxTokens) || a.maxTokens < 1 || a.maxTokens > 512))
        issues.push("autocomplete.maxTokens: must be an integer between 1 and 512")
    }
  }

  if (input.a2a !== undefined) validateA2a(input.a2a, issues)

  if (input.sessions !== undefined) {
    const x = input.sessions
    if (!isObject(x)) issues.push("sessions: must be an object")
    else {
      for (const key of Object.keys(x)) if (key !== "titles") issues.push(`sessions.${key}: unknown key`)
      if (x.titles !== undefined && x.titles !== "model" && x.titles !== "local") issues.push('sessions.titles: must be "model" or "local"')
    }
  }

  if (input.tips !== undefined) {
    const t = input.tips
    if (!isObject(t)) issues.push("tips: must be an object")
    else
      for (const [key, value] of Object.entries(t)) {
        if (key === "enabled") {
          if (typeof value !== "boolean") issues.push("tips.enabled: must be a boolean")
        } else if (!["complexity", "functionLines", "nesting", "parameters"].includes(key)) issues.push(`tips.${key}: unknown key`)
        else if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 1000) issues.push(`tips.${key}: must be an integer between 1 and 1000`)
      }
  }

  if (input.usage !== undefined) {
    const u = input.usage
    if (!isObject(u)) issues.push("usage: must be an object")
    else
      for (const [key, value] of Object.entries(u)) {
        if (key !== "minutesPerTask" && key !== "minutesPerAcceptedChange") issues.push(`usage.${key}: unknown key`)
        else if (typeof value !== "number" || !(value >= 0) || value > 480) issues.push(`usage.${key}: minutes between 0 and 480`)
      }
  }

  if (issues.length) throw new ConfigError(source, issues)
  return input as DeepPartial<BobiConfig>
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] }

/** Header and variable names whose values are credentials: they must be ${ENV_VAR} references. */
const SECRET_NAME = /(auth|token|secret|password|passwd|api[-_]?key|cookie|credential)/i
// An optional auth scheme prefix is allowed: "Bearer ${TOKEN}".
const ENV_REF = /^((Bearer|Basic|Token) )?\$\{[A-Z_][A-Z0-9_]*\}$/

function validateStringMap(value: unknown, at: string, issues: string[]) {
  if (!isObject(value)) return void issues.push(`${at}: must be an object of strings`)
  for (const [key, v] of Object.entries(value)) {
    if (typeof v !== "string") issues.push(`${at}.${key}: must be a string`)
    else if (SECRET_NAME.test(key) && !ENV_REF.test(v)) issues.push(`${at}.${key}: credentials must be an environment reference like \${MY_TOKEN}`)
  }
}

function validateMcp(mcp: unknown, issues: string[]) {
  if (!isObject(mcp)) return void issues.push("mcp: must be an object")
  for (const key of Object.keys(mcp)) if (key !== "servers" && key !== "timeout") issues.push(`mcp.${key}: unknown key`)
  if (mcp.timeout !== undefined) {
    if (!isObject(mcp.timeout)) issues.push("mcp.timeout: must be an object")
    else
      for (const [k, v] of Object.entries(mcp.timeout))
        if (!["startup", "execution"].includes(k) || typeof v !== "number" || !(v > 0)) issues.push(`mcp.timeout.${k}: positive milliseconds (startup, execution)`)
  }
  if (mcp.servers === undefined) return
  if (!isObject(mcp.servers)) return void issues.push("mcp.servers: must be an object")
  for (const [name, server] of Object.entries(mcp.servers)) {
    const at = `mcp.servers.${name}`
    // Tools are exposed as <server>_<tool>, so a server name must not contain "_".
    if (!/^[a-z][a-z0-9-]*$/.test(name)) issues.push(`${at}: name must be lowercase letters, digits and hyphens`)
    if (!isObject(server)) {
      issues.push(`${at}: must be an object`)
      continue
    }
    if (server.enabled !== undefined && typeof server.enabled !== "boolean") issues.push(`${at}.enabled: must be a boolean`)
    if (server.type === "local") {
      if (!Array.isArray(server.command) || server.command.length === 0 || server.command.some((c) => typeof c !== "string" || c === ""))
        issues.push(`${at}.command: must be a non-empty list of strings`)
      if (server.env !== undefined) validateStringMap(server.env, `${at}.env`, issues)
      if (server.cwd !== undefined && typeof server.cwd !== "string") issues.push(`${at}.cwd: must be a string`)
      for (const key of Object.keys(server)) if (!["type", "command", "env", "cwd", "enabled"].includes(key)) issues.push(`${at}.${key}: unknown key`)
    } else if (server.type === "remote") {
      if (typeof server.url !== "string" || !/^https?:\/\//.test(server.url)) issues.push(`${at}.url: must be an http(s) URL`)
      if (server.headers !== undefined) validateStringMap(server.headers, `${at}.headers`, issues)
      for (const key of Object.keys(server)) if (!["type", "url", "headers", "enabled"].includes(key)) issues.push(`${at}.${key}: unknown key`)
    } else issues.push(`${at}.type: must be "local" or "remote"`)
  }
}

function validateA2a(a2a: unknown, issues: string[]) {
  if (!isObject(a2a)) return void issues.push("a2a: must be an object")
  for (const key of Object.keys(a2a)) if (key !== "enabled" && key !== "agents") issues.push(`a2a.${key}: unknown key`)
  if (a2a.enabled !== undefined && typeof a2a.enabled !== "boolean") issues.push("a2a.enabled: must be a boolean")
  if (a2a.agents === undefined) return
  if (!isObject(a2a.agents)) return void issues.push("a2a.agents: must be an object")
  for (const [name, agent] of Object.entries(a2a.agents)) {
    const at = `a2a.agents.${name}`
    if (!/^[a-z][a-z0-9-]*$/.test(name)) issues.push(`${at}: name must be lowercase letters, digits and hyphens`)
    if (!isObject(agent)) {
      issues.push(`${at}: must be an object`)
      continue
    }
    if (typeof agent.url !== "string" || !/^https?:\/\//.test(agent.url)) issues.push(`${at}.url: must be an http(s) URL`)
    if (agent.headers !== undefined) validateStringMap(agent.headers, `${at}.headers`, issues)
    if (agent.description !== undefined && typeof agent.description !== "string") issues.push(`${at}.description: must be a string`)
    for (const key of Object.keys(agent)) if (!["url", "headers", "description"].includes(key)) issues.push(`${at}.${key}: unknown key`)
  }
}

/** Replaces ${VAR} references with environment values; returns the names of missing variables. */
export function expandEnv(value: string, env: Record<string, string | undefined>): { value: string; missing: string[] } {
  const missing: string[] = []
  const out = value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name: string) => {
    const v = env[name]
    if (v === undefined) missing.push(name)
    return v ?? ""
  })
  return { value: out, missing }
}
