// Translates a BobiConfig into the OpenCode V2 config document plus process environment.
// Everything that would contact vendor or third-party services is switched off here (ADR-0003).
import type { BobiConfig } from "./schema.ts"

export const PROVIDER_ID = "bobi"

/**
 * Internal OpenCode plugins disabled for on-prem use: cloud provider integrations, web-search
 * backends (third-party APIs) and runtime npm installs. `opencode.provider.opencode` is guarded
 * upstream and cannot be disabled by config; it stays inert without a vendor login.
 */
export const DISABLED_PLUGINS = [
  "opencode.provider.amazon.bedrock",
  "opencode.provider.azure",
  "opencode.provider.cerebras",
  "opencode.provider.chatgpt",
  "opencode.provider.cloudflare.ai.gateway",
  "opencode.provider.cloudflare.workers.ai",
  "opencode.provider.cohere",
  "opencode.provider.databricks",
  "opencode.provider.digitalocean",
  "opencode.provider.dynamic",
  "opencode.provider.github.copilot",
  "opencode.provider.gitlab",
  "opencode.provider.google.vertex",
  "opencode.provider.kilo",
  "opencode.provider.llmgateway",
  "opencode.provider.lmstudio",
  "opencode.provider.modal",
  "opencode.provider.neon",
  "opencode.provider.nvidia",
  "opencode.provider.ollama",
  "opencode.provider.openai",
  "opencode.provider.openrouter",
  "opencode.provider.perplexity",
  "opencode.provider.poe",
  "opencode.provider.sap.ai.core",
  "opencode.provider.snowflake.cortex",
  "opencode.provider.vercel",
  "opencode.provider.vllm",
  "opencode.provider.xai",
  "opencode.provider.zenmux",
  "opencode.tool.websearch",
  "opencode.websearch.exa",
  "opencode.websearch.firecrawl",
  "opencode.websearch.parallel",
  "opencode.websearch.tavily",
  "opencode.websearch.tinyfish",
] as const

/** Environment variables Bobi always sets for the OpenCode process. */
export const OFFLINE_ENV = {
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
} as const

/**
 * Options for embedding OpenCode via @opencode/sdk. The SDK ignores OPENCODE_DISABLE_MODELS_FETCH
 * (only the CLI reads it) and would fetch https://models.opencode.ai otherwise.
 */
export const SDK_OFFLINE_OPTIONS = { models: { fetch: false } } as const

const PACKAGES = {
  openai: "aisdk:@ai-sdk/openai-compatible",
  anthropic: "aisdk:@ai-sdk/anthropic",
} as const

export type OpenCodeConfig = Record<string, unknown>

export type ToOpenCodeOptions = {
  /** Plugin entries appended after the disable directives, e.g. the @bobi/core entrypoint. */
  readonly plugins?: readonly (string | { package: string; options?: Record<string, unknown> })[]
}

export function modelIds(config: BobiConfig): string[] {
  const ids = [config.model.default, ...config.model.models]
  for (const mode of Object.values(config.modes)) if (mode.model) ids.push(mode.model)
  return [...new Set(ids)]
}

export function toOpenCodeConfig(config: BobiConfig, options: ToOpenCodeOptions = {}): OpenCodeConfig {
  const agents: Record<string, { model: string }> = {}
  for (const [slug, mode] of Object.entries(config.modes)) {
    if (mode.model) agents[slug] = { model: `${PROVIDER_ID}/${mode.model}` }
  }
  return {
    model: `${PROVIDER_ID}/${config.model.default}`,
    update: "disable",
    share: "disabled",
    websearch: false,
    snapshots: config.checkpoints.enabled,
    username: config.telemetry.user,
    providers: {
      [PROVIDER_ID]: {
        name: "Bobi model endpoint",
        package: PACKAGES[config.model.protocol],
        env: [config.model.apiKeyEnv],
        settings: { baseURL: config.model.baseURL },
        models: Object.fromEntries(modelIds(config).map((id) => [id, {}])),
      },
    },
    ...(Object.keys(agents).length ? { agents } : {}),
    plugins: [...DISABLED_PLUGINS.map((id) => `-${id}`), ...(options.plugins ?? [])],
  }
}

/** Environment for the OpenCode process: offline switches plus optional OTLP export. */
export function toOpenCodeEnv(config: BobiConfig): Record<string, string> {
  return {
    ...OFFLINE_ENV,
    ...(config.telemetry.otlpEndpoint ? { OTEL_EXPORTER_OTLP_ENDPOINT: config.telemetry.otlpEndpoint } : {}),
  }
}
