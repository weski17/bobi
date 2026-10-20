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
