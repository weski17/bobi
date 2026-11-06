import { describe, expect, test } from "bun:test"
import { HELP, parseArgs, UsageError } from "../src/args.ts"

describe("parseArgs", () => {
  test("no arguments start the TUI", () => {
    expect(parseArgs([])).toEqual({ kind: "tui", client: [] })
    expect(parseArgs(["./project"])).toEqual({ kind: "tui", directory: "./project", client: [] })
  })

  test("help and version", () => {
    for (const a of ["--help", "-h", "help"]) expect(parseArgs([a])).toEqual({ kind: "help" })
    for (const a of ["--version", "-v"]) expect(parseArgs([a])).toEqual({ kind: "version" })
    expect(HELP).toContain("bobi serve")
  })

  test("run forwards only allowed flags", () => {
    expect(parseArgs(["run", "-m", "big", "--format", "json", "-c", "fix", "the", "bug"])).toEqual({
      kind: "run",
      client: ["-m", "big", "--format", "json", "-c", "fix", "the", "bug"],
    })
  })

  test.each([
    [["run", "--auto", "x"], /unknown option for run: --auto/],
    [["run", "--server", "http://evil", "x"], /unknown option/],
    [["run", "--model"], /needs a value/],
    [["run"], /needs a message/],
    [["run", "-m", "big"], /needs a message/],
    [["serve", "--port", "99999"], /port number/],
    [["serve", "--hostname"], /needs a value/],
    [["serve", "--bogus"], /unknown option for serve/],
    [["upgrade", "now"], /unknown command/],
    [["--auto"], /unknown command/],
  ])("refuses %p", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(UsageError)
    expect(() => parseArgs(argv)).toThrow(message)
  })

  test("attach takes a server URL and optionally a run command", () => {
    expect(parseArgs(["attach", "http://127.0.0.1:4096"])).toEqual({ kind: "attach", url: "http://127.0.0.1:4096", client: [] })
    expect(parseArgs(["attach", "http://127.0.0.1:4096", "run", "-m", "big", "fix it"])).toEqual({
      kind: "attach",
      url: "http://127.0.0.1:4096",
      client: ["run", "-m", "big", "fix it"],
    })
    expect(() => parseArgs(["attach"])).toThrow(/server URL/)
    expect(() => parseArgs(["attach", "file:///x"])).toThrow(/server URL/)
    expect(() => parseArgs(["attach", "http://h", "serve"])).toThrow(/only a run command/)
  })

  test("modes and --mode", () => {
    expect(parseArgs(["modes"])).toEqual({ kind: "modes", json: false })
    expect(parseArgs(["modes", "--json"])).toEqual({ kind: "modes", json: true })
    expect(() => parseArgs(["modes", "--x"])).toThrow(/unknown option for modes/)
    expect(parseArgs(["run", "--mode", "plan", "x"])).toEqual({ kind: "run", client: ["--agent", "plan", "x"] })
  })

  test("dossier", () => {
    expect(parseArgs(["dossier"])).toEqual({ kind: "dossier", action: "seal", format: "md", diff: false })
    expect(parseArgs(["dossier", "--list"])).toMatchObject({ action: "list" })
    expect(parseArgs(["dossier", "--session", "s1", "--out", "d.json", "--diff", "--test", "bun test", "--format", "json"])).toEqual({
      kind: "dossier",
      action: "seal",
      session: "s1",
      out: "d.json",
      diff: true,
      test: "bun test",
      format: "json",
    })
    expect(parseArgs(["dossier", "verify", "d.json", "--key", "pub.pem"])).toEqual({ kind: "dossier", action: "verify", file: "d.json", key: "pub.pem" })
    expect(() => parseArgs(["dossier", "verify"])).toThrow(/needs a dossier file/)
    expect(() => parseArgs(["dossier", "verify", "a", "b"])).toThrow(/one file/)
    expect(() => parseArgs(["dossier", "verify", "a", "--x"])).toThrow(/unknown option/)
    expect(() => parseArgs(["dossier", "--key"])).toThrow(/unknown option/)
    expect(() => parseArgs(["dossier", "--out"])).toThrow(/needs a value/)
    expect(() => parseArgs(["dossier", "--format", "pdf"])).toThrow(/md or json/)
  })

  test("tips --since", () => {
    expect(parseArgs(["tips", "--since", "origin/main", "--fail-on", "warning"])).toMatchObject({ kind: "tips", since: "origin/main", failOn: "warning" })
    expect(() => parseArgs(["tips", "--since"])).toThrow(/needs a git ref/)
    expect(() => parseArgs(["tips", "--since", "--format"])).toThrow(/needs a git ref/)
  })

  test("compare", () => {
    expect(parseArgs(["compare", "--models", "a, b,a", "--mode", "plan", "--test", "bun test", "--out", "r.json", "fix", "the", "bug"])).toEqual({
      kind: "compare",
      models: ["a", "b"],
      mode: "plan",
      test: "bun test",
      out: "r.json",
      task: "fix the bug",
    })
    expect(parseArgs(["compare", "--models", "a,b", "task"])).toMatchObject({ mode: "code", task: "task" })
    expect(() => parseArgs(["compare", "--models", "a", "task"])).toThrow(/2 to 4 models/)
    expect(() => parseArgs(["compare", "--models", "a,b,c,d,e", "task"])).toThrow(/2 to 4 models/)
    expect(() => parseArgs(["compare", "--models", "a,b"])).toThrow(/needs a task/)
    expect(() => parseArgs(["compare", "--models"])).toThrow(/needs a value/)
    expect(() => parseArgs(["compare", "--x", "t"])).toThrow(/unknown option for compare/)
  })

  test("registry", () => {
    expect(parseArgs(["registry", "pack", "skills/x", "--version", "1.0.0", "--description", "d", "--out", "dist"])).toEqual({ kind: "registry", action: "pack", source: "skills/x", version: "1.0.0", description: "d", out: "dist" })
    expect(parseArgs(["registry", "install", "x", "--from", "reg", "--project", "--force"])).toEqual({ kind: "registry", action: "install", target: "x", from: "reg", project: true, force: true })
    expect(parseArgs(["registry", "install", "x.bobipkg.json"])).toMatchObject({ project: false, force: false })
    expect(parseArgs(["registry", "trust", "a.pem"])).toEqual({ kind: "registry", action: "trust", target: "a.pem" })
    expect(parseArgs(["registry", "revoke", "deploy", "--version", "1.0.0", "--key-id", "k", "--hash", "h", "--reason", "leak", "--out", "reg"])).toEqual({ kind: "registry", action: "revoke", name: "deploy", version: "1.0.0", keyId: "k", hash: "h", reason: "leak", out: "reg" })
    expect(parseArgs(["registry", "revoke", "--key-id", "k", "--reason", "stolen key"])).toMatchObject({ action: "revoke", name: undefined, keyId: "k" })
    expect(() => parseArgs(["registry", "revoke", "deploy"])).toThrow(/--reason/)
    expect(() => parseArgs(["registry", "revoke", "a", "b", "--reason", "x"])).toThrow(/at most one/)
    expect(parseArgs(["registry", "check"])).toEqual({ kind: "registry", action: "check", from: undefined, project: false, remove: false })
    expect(parseArgs(["registry", "check", "--from", "reg", "--project", "--remove"])).toEqual({ kind: "registry", action: "check", from: "reg", project: true, remove: true })
    expect(() => parseArgs(["registry", "check", "extra"])).toThrow(/no arguments/)
    expect(parseArgs(["registry", "untrust", "abc"])).toMatchObject({ action: "untrust" })
    expect(parseArgs(["registry", "verify", "p.json"])).toMatchObject({ action: "verify" })
    expect(parseArgs(["registry", "list", "--from", "reg"])).toEqual({ kind: "registry", action: "list", from: "reg" })
    expect(parseArgs(["registry", "key"])).toEqual({ kind: "registry", action: "key" })
    expect(() => parseArgs(["registry", "pack", "x"])).toThrow(/needs --version/)
    expect(() => parseArgs(["registry", "pack", "--version", "1.0.0"])).toThrow(/needs a skill directory/)
    expect(() => parseArgs(["registry", "install"])).toThrow(/needs a package name/)
    expect(() => parseArgs(["registry", "install", "x", "--from"])).toThrow(/needs a value/)
    expect(() => parseArgs(["registry", "install", "x", "--wat"])).toThrow(/unknown option/)
    expect(() => parseArgs(["registry", "nope"])).toThrow(/registry commands/)
    expect(() => parseArgs(["registry"])).toThrow(/registry commands/)
  })

  test("audit and diagram", () => {
    expect(parseArgs(["audit"])).toEqual({ kind: "audit", format: "md" })
    expect(parseArgs(["audit", "report", "--from", "2026-10-01", "--to", "2026-10-31", "--user", "anna", "--format", "json"])).toEqual({
      kind: "audit",
      from: "2026-10-01",
      to: "2026-10-31",
      user: "anna",
      format: "json",
    })
    expect(() => parseArgs(["audit", "--from", "yesterday"])).toThrow(/date like/)
    expect(() => parseArgs(["audit", "--user"])).toThrow(/needs a value/)
    expect(() => parseArgs(["audit", "--format", "pdf"])).toThrow(/md or json/)
    expect(() => parseArgs(["audit", "--x"])).toThrow(/unknown option for audit/)
    expect(parseArgs(["usage", "--team", "payments", "--format", "json", "--from", "2026-10-01"])).toEqual({ kind: "usage", team: "payments", format: "json", from: "2026-10-01" })
    expect(() => parseArgs(["usage", "--user", "anna"])).toThrow(/unknown option for usage/)
    expect(parseArgs(["diagram"])).toEqual({ kind: "diagram", source: "code" })
    expect(parseArgs(["diagram", "cobol", "--program", "CBACT01C", "app"])).toEqual({ kind: "diagram", source: "cobol", program: "CBACT01C", directory: "app" })
    expect(parseArgs(["diagram", "code", "--depth", "3"])).toEqual({ kind: "diagram", source: "code", depth: 3 })
    expect(() => parseArgs(["diagram", "--depth", "9"])).toThrow(/between 1 and 4/)
    expect(() => parseArgs(["diagram", "--program"])).toThrow(/needs a value/)
    expect(() => parseArgs(["diagram", "--program", "X"])).toThrow(/only for cobol/)
    expect(() => parseArgs(["diagram", "a", "b"])).toThrow(/one directory/)
    expect(() => parseArgs(["diagram", "--svg"])).toThrow(/unknown option for diagram/)
  })

  test("tips", () => {
    expect(parseArgs(["tips"])).toEqual({ kind: "tips", paths: [], format: "text" })
    expect(parseArgs(["tips", "--format", "json", "--fail-on", "warning", "src", "lib"])).toEqual({ kind: "tips", paths: ["src", "lib"], format: "json", failOn: "warning" })
    expect(() => parseArgs(["tips", "--format", "xml"])).toThrow(/text or json/)
    expect(() => parseArgs(["tips", "--fail-on", "error"])).toThrow(/warning or info/)
    expect(() => parseArgs(["tips", "--x"])).toThrow(/unknown option for tips/)
  })

  test("trust", () => {
    expect(parseArgs(["trust"])).toEqual({ kind: "trust", action: "status" })
    expect(parseArgs(["trust", "--yes", "./p"])).toEqual({ kind: "trust", action: "yes", directory: "./p" })
    expect(parseArgs(["trust", "--no"])).toEqual({ kind: "trust", action: "no" })
    expect(() => parseArgs(["trust", "--maybe"])).toThrow(/unknown option for trust/)
    expect(() => parseArgs(["trust", "a", "b"])).toThrow(/one directory/)
  })

  test("serve defaults to loopback and a random port", () => {
    expect(parseArgs(["serve"])).toEqual({ kind: "serve", hostname: "127.0.0.1", port: 0 })
    expect(parseArgs(["serve", "--hostname", "0.0.0.0", "--port", "4096"])).toEqual({ kind: "serve", hostname: "0.0.0.0", port: 4096 })
  })
})
