import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  ConfigError,
  DEFAULTS,
  DISABLED_PLUGINS,
  findProjectRoot,
  loadConfig,
  modelIds,
  toOpenCodeConfig,
  toOpenCodeEnv,
  validatePartial,
} from "../src/index.ts"

let root: string
let home: string
let project: string

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "bobi-config-"))
  home = path.join(root, "home")
  project = path.join(root, "project")
  mkdirSync(path.join(home, ".bobi"), { recursive: true })
  mkdirSync(path.join(project, ".bobi"), { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const write = (file: string, content: string) => writeFileSync(file, content)
const load = (env: Record<string, string> = {}, cwd = project) => loadConfig({ cwd, home, env })

describe("loadConfig", () => {
  test("defaults point to a local LiteLLM endpoint and need no files", () => {
    const { config, sources, apiKey } = load()
    expect(config.model.baseURL).toBe("http://localhost:4000/v1")
    expect(config.model.protocol).toBe("openai")
    expect(config.autoApprove).toEqual([])
    expect(config.checkpoints.enabled).toBe(true)
    expect(sources).toEqual([])
    expect(apiKey).toBeUndefined()
  })

  test("project config overrides global config, JSONC comments allowed", () => {
    write(path.join(home, ".bobi", "config.jsonc"), `{ // global\n "model": { "baseURL": "http://global:4000/v1", "default": "big" } }`)
    write(path.join(project, ".bobi", "config.jsonc"), `{ "model": { "default": "small", }, /* trailing */ }`)
    const { config, sources } = load()
    expect(config.model.baseURL).toBe("http://global:4000/v1")
    expect(config.model.default).toBe("small")
    expect(sources).toHaveLength(2)
  })

  test("BOBI_CONFIG has precedence over project config, environment over everything", () => {
    write(path.join(project, ".bobi", "config.jsonc"), `{ "model": { "default": "project" } }`)
    write(path.join(root, "extra.jsonc"), `{ "model": { "default": "extra", "baseURL": "http://extra/v1" } }`)
    const { config } = load({ BOBI_CONFIG: path.join(root, "extra.jsonc"), BOBI_MODEL: "env-model" })
    expect(config.model.default).toBe("env-model")
    expect(config.model.baseURL).toBe("http://extra/v1")
  })

  test("environment sets endpoint, protocol, user and OTLP endpoint", () => {
    const { config } = load({
      BOBI_MODEL_BASE_URL: "http://gw:4000/v1",
      BOBI_MODEL_PROTOCOL: "anthropic",
      BOBI_USER: "alice",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318",
    })
    expect(config.model).toMatchObject({ baseURL: "http://gw:4000/v1", protocol: "anthropic" })
    expect(config.telemetry).toEqual({ user: "alice", otlpEndpoint: "http://otel:4318" })
  })

  test("API key is read only from the configured environment variable", () => {
    write(path.join(project, ".bobi", "config.jsonc"), `{ "model": { "apiKeyEnv": "MY_GATEWAY_KEY" } }`)
    expect(load({ MY_GATEWAY_KEY: "k", BOBI_MODEL_API_KEY: "other" }).apiKey).toBe("k")
  })

  test("user falls back to $USER", () => {
    expect(load({ USER: "bob" }).config.telemetry.user).toBe("bob")
    expect(load({}).config.telemetry.user).toBe("unknown")
  })

  test("auto-approvals from all files accumulate", () => {
    write(path.join(home, ".bobi", "config.jsonc"), `{ "autoApprove": [{ "action": "shell", "resource": "git status" }] }`)
    write(path.join(project, ".bobi", "config.jsonc"), `{ "autoApprove": [{ "action": "edit", "resource": "docs/**", "modes": ["code"] }] }`)
    expect(load().config.autoApprove).toEqual([
      { action: "shell", resource: "git status", modes: [] },
      { action: "edit", resource: "docs/**", modes: ["code"] },
    ])
  })

  test("missing BOBI_CONFIG file is an error", () => {
    expect(() => load({ BOBI_CONFIG: "nope.jsonc" })).toThrow(ConfigError)
  })

  test("unparsable JSONC is reported with the file name", () => {
    write(path.join(project, ".bobi", "config.jsonc"), `{ "model": `)
    expect(() => load()).toThrow(/config\.jsonc/)
  })

  test("project root is found from a subdirectory", () => {
    const sub = path.join(project, "src", "deep")
    mkdirSync(sub, { recursive: true })
    write(path.join(project, ".bobi", "config.jsonc"), `{ "model": { "default": "from-root" } }`)
    expect(findProjectRoot(sub)).toBe(project)
    expect(load({}, sub).config.model.default).toBe("from-root")
  })

  test("without .bobi or .git the cwd is the project root", () => {
    const lone = path.join(root, "lone")
    mkdirSync(lone)
    expect(findProjectRoot(lone)).toBe(lone)
  })
})

describe("validatePartial", () => {
  test("rejects secrets anywhere in a config file", () => {
    expect(() => validatePartial({ model: { apiKey: "sk-123" } }, "f")).toThrow(/model\.apiKey: secrets are not allowed/)
    expect(() => validatePartial({ telemetry: { token: "x" } }, "f")).toThrow(/telemetry\.token/)
  })

  test("reports every issue at once", () => {
    try {
      validatePartial(
        {
          nope: 1,
          model: { baseURL: "ftp://x", protocol: "grpc", apiKeyEnv: "lower", default: "", models: [1] },
          modes: { Bad_Slug: { model: 3 } },
          autoApprove: [{ action: "rm", resource: "" }, "x", { action: "edit", resource: "a", modes: "code" }],
          telemetry: { otlpEndpoint: "nope", user: 1, auditLog: "yes" },
          checkpoints: { enabled: "yes" },
        },
        "file.jsonc",
      )
      throw new Error("expected ConfigError")
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError)
      const issues = (error as ConfigError).issues
      for (const fragment of [
        "nope: unknown key",
        "model.baseURL",
        "model.protocol",
        "model.apiKeyEnv",
        "model.default",
        "model.models",
        "modes.Bad_Slug: slug",
        "modes.Bad_Slug.model",
        "autoApprove[0].action",
        "autoApprove[0].resource",
        "autoApprove[1]: must be an object",
        "autoApprove[2].modes",
        "telemetry.otlpEndpoint",
        "telemetry.user",
        "telemetry.auditLog",
        "checkpoints.enabled",
      ])
        expect(issues.some((i) => i.startsWith(fragment))).toBe(true)
    }
  })

  test("rejects non-object documents and wrong section types", () => {
    expect(() => validatePartial([], "f")).toThrow(/JSON object/)
    expect(() => validatePartial({ model: 1, modes: [], autoApprove: {}, telemetry: 1 }, "f")).toThrow(ConfigError)
    expect(() => validatePartial({ modes: { code: 1 } }, "f")).toThrow(/modes\.code: must be an object/)
  })

  test("accepts a valid document", () => {
    const doc = { $schema: "x", model: { baseURL: "https://gw/v1", protocol: "openai" }, modes: { plan: { model: "big" } } }
    expect(validatePartial(doc, "f")).toEqual(doc as never)
  })
})

describe("toOpenCodeConfig", () => {
  const config = {
    ...structuredClone(DEFAULTS),
    model: { ...DEFAULTS.model, default: "small", models: ["extra"] },
    modes: { plan: { model: "big" }, code: {} },
    telemetry: { user: "alice" },
  }

  test("maps the endpoint to one OpenAI-compatible provider without any key", () => {
    const out = toOpenCodeConfig(config) as any
    expect(out.model).toBe("bobi/small")
    expect(out.providers.bobi).toEqual({
      name: "Bobi model endpoint",
      package: "aisdk:@ai-sdk/openai-compatible",
      env: ["BOBI_MODEL_API_KEY"],
      settings: { baseURL: "http://localhost:4000/v1" },
      models: { small: {}, extra: {}, big: {} },
    })
    expect(JSON.stringify(out)).not.toMatch(/apiKey/)
  })

  test("uses the Anthropic package for protocol anthropic", () => {
    const out = toOpenCodeConfig({ ...config, model: { ...config.model, protocol: "anthropic" } }) as any
    expect(out.providers.bobi.package).toBe("aisdk:@ai-sdk/anthropic")
  })

  test("sets a model per mode", () => {
    expect((toOpenCodeConfig(config) as any).agents).toEqual({ plan: { model: "bobi/big" } })
    expect((toOpenCodeConfig({ ...config, modes: {} }) as any).agents).toBeUndefined()
  })

  test("switches off updates, sharing, web search and vendor plugins", () => {
    const out = toOpenCodeConfig(config, { plugins: ["/abs/bobi-core.ts"] }) as any
    expect(out).toMatchObject({ update: "disable", share: "disabled", websearch: false, snapshots: true, username: "alice" })
    expect(out.plugins.at(-1)).toBe("/abs/bobi-core.ts")
    for (const id of ["opencode.provider.dynamic", "opencode.provider.github.copilot", "opencode.websearch.exa", "opencode.tool.websearch"])
      expect(out.plugins).toContain(`-${id}`)
    expect(out.plugins).toHaveLength(DISABLED_PLUGINS.length + 1)
  })

  test("model ids are de-duplicated", () => {
    expect(modelIds({ ...config, model: { ...config.model, models: ["small", "big"] } })).toEqual(["small", "big"])
  })

  test("process environment disables model catalog fetch and auto-update", () => {
    expect(toOpenCodeEnv(config)).toEqual({ OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_AUTOUPDATE: "1" })
    expect(toOpenCodeEnv({ ...config, telemetry: { otlpEndpoint: "http://otel:4318" } }).OTEL_EXPORTER_OTLP_ENDPOINT).toBe("http://otel:4318")
  })
})

test("autocomplete: off by default, validated, merged per file", () => {
  expect(DEFAULTS.autocomplete).toEqual({})
  expect(validatePartial({ autocomplete: { model: "coder", maxTokens: 64 } }, "f")).toEqual({ autocomplete: { model: "coder", maxTokens: 64 } })
  for (const [value, message] of [
    [1, "autocomplete: must be an object"],
    [{ model: "" }, "autocomplete.model"],
    [{ maxTokens: 0 }, "autocomplete.maxTokens"],
    [{ maxTokens: 1.5 }, "autocomplete.maxTokens"],
    [{ temperature: 1 }, "autocomplete.temperature: unknown key"],
  ] as const)
    expect(() => validatePartial({ autocomplete: value }, "f")).toThrow(message)
})

test("a2a: inbound only from the global config or BOBI_A2A, agents merge and are validated", () => {
  expect(DEFAULTS.a2a).toEqual({ enabled: false, agents: {} })
  write(path.join(home, ".bobi", "config.jsonc"), JSON.stringify({ a2a: { enabled: true, agents: { docs: { url: "https://docs.intranet/a2a" } } } }))
  write(path.join(project, ".bobi", "config.jsonc"), JSON.stringify({ a2a: { agents: { tickets: { url: "http://tickets:8080", headers: { Authorization: "Bearer ${T}" } } } } }))
  const merged = load().config.a2a
  expect(merged.enabled).toBe(true)
  expect(Object.keys(merged.agents)).toEqual(["docs", "tickets"])
  expect(load({ BOBI_A2A: "0" }).config.a2a.enabled).toBe(false)
  write(path.join(home, ".bobi", "config.jsonc"), "{}")
  expect(load({ BOBI_A2A: "1" }).config.a2a.enabled).toBe(true)
  expect(load({ BOBI_A2A: "true" }).config.a2a.enabled).toBe(true)
  write(path.join(project, ".bobi", "config.jsonc"), JSON.stringify({ a2a: { enabled: true } }))
  expect(() => load()).toThrow("a2a.enabled: can only be set in the global config")
  for (const [value, message] of [
    [1, "a2a: must be an object"],
    [{ enabled: "yes" }, "a2a.enabled"],
    [{ other: 1 }, "a2a.other: unknown key"],
    [{ agents: [] }, "a2a.agents: must be an object"],
    [{ agents: { Bad_Name: { url: "http://x" } } }, "name must be lowercase"],
    [{ agents: { x: 1 } }, "a2a.agents.x: must be an object"],
    [{ agents: { x: { url: "ftp://x" } } }, "a2a.agents.x.url"],
    [{ agents: { x: { url: "http://x", headers: { Authorization: "Bearer plain" } } } }, "credentials must be an environment reference"],
    [{ agents: { x: { url: "http://x", description: 1 } } }, "a2a.agents.x.description"],
    [{ agents: { x: { url: "http://x", token: "${T}" } } }, "secrets are not allowed"],
    [{ agents: { x: { url: "http://x", extra: 1 } } }, "a2a.agents.x.extra: unknown key"],
  ] as const)
    expect(() => validatePartial({ a2a: value }, "f")).toThrow(message)
})

test("usage and tips: validated and merged", () => {
  expect(DEFAULTS.usage).toEqual({})
  expect(DEFAULTS.tips).toEqual({})
  write(path.join(home, ".bobi", "config.jsonc"), JSON.stringify({ usage: { minutesPerTask: 20 }, tips: { complexity: 15 }, telemetry: { team: "payments" } }))
  write(path.join(project, ".bobi", "config.jsonc"), JSON.stringify({ tips: { nesting: 3 } }))
  const { config } = load()
  expect(config.usage).toEqual({ minutesPerTask: 20 })
  expect(config.tips).toEqual({ complexity: 15, nesting: 3 })
  expect(config.telemetry.team).toBe("payments")
  expect(load({ BOBI_TEAM: "core" }).config.telemetry.team).toBe("core")
  for (const [doc, message] of [
    [{ usage: 1 }, "usage: must be an object"],
    [{ usage: { minutesPerTask: -1 } }, "usage.minutesPerTask"],
    [{ usage: { other: 1 } }, "usage.other: unknown key"],
    [{ tips: [] }, "tips: must be an object"],
    [{ tips: { enabled: "no" } }, "tips.enabled"],
    [{ tips: { complexity: 0 } }, "tips.complexity"],
    [{ tips: { color: 1 } }, "tips.color: unknown key"],
    [{ telemetry: { team: "" } }, "telemetry.team"],
  ] as const)
    expect(() => validatePartial(doc, "f")).toThrow(message)
})

test("sessions.titles: default model, validated, merged, env override", () => {
  expect(DEFAULTS.sessions).toEqual({ titles: "model" })
  write(path.join(home, ".bobi", "config.jsonc"), JSON.stringify({ sessions: { titles: "local" } }))
  expect(load().config.sessions.titles).toBe("local")
  expect(load({ BOBI_SESSION_TITLES: "model" }).config.sessions.titles).toBe("model")
  for (const [doc, message] of [
    [{ sessions: 1 }, "sessions: must be an object"],
    [{ sessions: { titles: "ai" } }, 'sessions.titles: must be "model" or "local"'],
    [{ sessions: { other: 1 } }, "sessions.other: unknown key"],
  ] as const)
    expect(() => validatePartial(doc, "f")).toThrow(message)
})
