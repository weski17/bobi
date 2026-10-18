import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { DEFAULTS } from "@bobi/config"
import { BLOCKED_COMMANDS, buildLaunch, CORE_ENTRY, LaunchError, OPENCODE_CLI, preloadPath } from "../src/launcher.ts"

const config = { ...structuredClone(DEFAULTS), telemetry: { user: "t", otlpEndpoint: "http://otel:4318" } }

describe("buildLaunch", () => {
  test("runs the pinned OpenCode CLI with the JSX preload", () => {
    const { argv } = buildLaunch(config, ["run", "hi"], {})
    expect(argv.slice(1, 4)).toEqual(["--preload", preloadPath(), OPENCODE_CLI])
    expect(argv.slice(4)).toEqual(["run", "hi"])
    expect(existsSync(OPENCODE_CLI)).toBe(true)
    expect(existsSync(`${CORE_ENTRY}/index.ts`)).toBe(true)
  })

  test("passes the translated config, offline switches and isolation via the environment", () => {
    const { env } = buildLaunch(config, [], { PATH: "/bin", BOBI_MODEL_API_KEY: "k", UNSET: undefined, BOBI_OPENCODE_CONFIG_DIR: "/tmp/oc" })
    expect(env).toMatchObject({
      PATH: "/bin",
      BOBI_MODEL_API_KEY: "k",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://otel:4318",
      OPENCODE_CONFIG_DIR: "/tmp/oc",
      OPENCODE_CLIENT: "bobi",
    })
    expect("UNSET" in env).toBe(false)
    const opencode = JSON.parse(env.OPENCODE_CONFIG_CONTENT!)
    expect(opencode.plugins.at(-1)).toEqual({ package: CORE_ENTRY })
    expect(env.OPENCODE_CONFIG_CONTENT).not.toContain("\"k\"")
  })

  test("defaults the OpenCode config dir to ~/.bobi/opencode", () => {
    expect(buildLaunch(config, [], {}).env.OPENCODE_CONFIG_DIR).toEndWith("/.bobi/opencode")
  })

  test("session commands get a Bobi-managed server, others do not", () => {
    expect(buildLaunch(config, [], {}).session).toBe(true)
    expect(buildLaunch(config, ["run", "x"], {}).session).toBe(true)
    expect(buildLaunch(config, ["mini"], {}).session).toBe(true)
    expect(buildLaunch(config, ["./some/project"], {}).session).toBe(true)
    expect(buildLaunch(config, ["run", "x", "--server", "http://h"], {}).session).toBe(false)
    expect(buildLaunch(config, ["models"], {}).session).toBe(false)
    expect(buildLaunch(config, ["serve"], {}).session).toBe(false)
  })

  test.each([...BLOCKED_COMMANDS])("blocks the %s command", (command) => {
    expect(() => buildLaunch(config, [command], {})).toThrow(LaunchError)
  })

  test("blocks --auto", () => {
    expect(() => buildLaunch(config, ["run", "--auto", "x"], {})).toThrow(/auto-approvals/)
  })
})
