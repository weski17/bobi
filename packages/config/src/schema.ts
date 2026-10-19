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

export type BobiConfig = {
  model: ModelEndpoint
  /** Per-mode model selection: mode slug → model id. */
  modes: Record<string, { model?: string }>
  /** Explicit auto-approvals. Default: every write, shell command and network action asks. */
  autoApprove: AutoApproveRule[]
  telemetry: { otlpEndpoint?: string; user?: string }
  checkpoints: { enabled: boolean }
}

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

  const known = new Set(["$schema", "model", "modes", "autoApprove", "telemetry", "checkpoints"])
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
    }
  }

  if (input.checkpoints !== undefined) {
    if (!isObject(input.checkpoints) || (input.checkpoints.enabled !== undefined && typeof input.checkpoints.enabled !== "boolean"))
      issues.push("checkpoints.enabled: must be a boolean")
  }

  if (issues.length) throw new ConfigError(source, issues)
  return input as DeepPartial<BobiConfig>
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends (infer U)[] ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K] }
