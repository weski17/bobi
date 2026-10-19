import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { ConfigError, expandEnv, loadConfig, validatePartial } from "../src/index.ts"

test("accepts local and remote servers with environment references for credentials", () => {
  const doc = {
    mcp: {
      timeout: { startup: 5000, execution: 60000 },
      servers: {
        jira: { type: "remote", url: "https://jira.intranet/mcp", headers: { Authorization: "Bearer ${JIRA_TOKEN}", "X-Api-Key": "${KEY}", "X-Team": "core" } },
        "code-graph": { type: "local", command: ["bun", "server.ts"], env: { API_KEY: "${KEY}", MODE: "fast" }, cwd: "tools", enabled: false },
      },
    },
  }
  expect(validatePartial(doc, "f")).toEqual(doc as never)
})

test("reports invalid MCP configuration", () => {
  const issues = (() => {
    try {
      validatePartial(
        {
          mcp: {
            extra: 1,
            timeout: { startup: -1, other: 5 },
            servers: {
              Bad_Name: { type: "local", command: ["x"] },
              empty: { type: "local", command: [] },
              plain: { type: "remote", url: "https://x", headers: { Authorization: "Bearer abc" } },
              env: { type: "local", command: ["x"], env: { DB_PASSWORD: "hunter2", N: 1 }, cwd: 3, enabled: "yes", foo: 1 },
              ftp: { type: "remote", url: "ftp://x", headers: [], bar: 1 },
              odd: { type: "socket" },
              str: "x",
            },
          },
        },
        "f",
      )
    } catch (e) {
      return (e as ConfigError).issues.join("\n")
    }
    return ""
  })()
  for (const fragment of [
    "mcp.extra: unknown key",
    "mcp.timeout.startup",
    "mcp.timeout.other",
    "mcp.servers.Bad_Name: name must be lowercase",
    "mcp.servers.empty.command",
    "mcp.servers.plain.headers.Authorization: credentials must be an environment reference",
    "mcp.servers.env.env.DB_PASSWORD: credentials must",
    "mcp.servers.env.env.N: must be a string",
    "mcp.servers.env.cwd",
    "mcp.servers.env.enabled",
    "mcp.servers.env.foo: unknown key",
    "mcp.servers.ftp.url",
    "mcp.servers.ftp.headers: must be an object",
    "mcp.servers.ftp.bar: unknown key",
    'mcp.servers.odd.type: must be "local" or "remote"',
    "mcp.servers.str: must be an object",
  ])
    expect(issues).toContain(fragment)
  expect(() => validatePartial({ mcp: 1 }, "f")).toThrow(/mcp: must be an object/)
  expect(() => validatePartial({ mcp: { servers: [] } }, "f")).toThrow(/mcp.servers: must be an object/)
  expect(() => validatePartial({ mcp: { timeout: 3 } }, "f")).toThrow(/mcp.timeout: must be an object/)
})

let dir: string
beforeEach(() => (dir = mkdtempSync(path.join(tmpdir(), "bobi-mcp-cfg-"))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

test("servers merge by name across global and project config", () => {
  mkdirSync(path.join(dir, "home"))
  mkdirSync(path.join(dir, "p", ".bobi"), { recursive: true })
  writeFileSync(path.join(dir, "home", "config.jsonc"), `{ "mcp": { "timeout": { "startup": 1000 }, "servers": { "a": { "type": "local", "command": ["a"] }, "b": { "type": "local", "command": ["b"] } } } }`)
  writeFileSync(path.join(dir, "p", ".bobi", "config.jsonc"), `{ "mcp": { "timeout": { "execution": 2000 }, "servers": { "b": { "type": "remote", "url": "https://b" } } } }`)
  const { config } = loadConfig({ cwd: path.join(dir, "p"), env: { BOBI_HOME: path.join(dir, "home") } })
  expect(config.mcp).toEqual({
    servers: { a: { type: "local", command: ["a"] }, b: { type: "remote", url: "https://b" } },
    timeout: { startup: 1000, execution: 2000 },
  })
})

test("expandEnv substitutes references and reports missing variables", () => {
  expect(expandEnv("Bearer ${TOKEN}", { TOKEN: "t" })).toEqual({ value: "Bearer t", missing: [] })
  expect(expandEnv("${A}-${B}", { A: "a" })).toEqual({ value: "a-", missing: ["B"] })
  expect(expandEnv("plain", {})).toEqual({ value: "plain", missing: [] })
})
