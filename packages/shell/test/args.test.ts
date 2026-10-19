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

  test("serve defaults to loopback and a random port", () => {
    expect(parseArgs(["serve"])).toEqual({ kind: "serve", hostname: "127.0.0.1", port: 0 })
    expect(parseArgs(["serve", "--hostname", "0.0.0.0", "--port", "4096"])).toEqual({ kind: "serve", hostname: "0.0.0.0", port: 4096 })
  })
})
