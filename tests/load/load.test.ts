// Small load run in CI: parallel sessions must all be answered; full runs: bun run test:load.
import { expect, test } from "bun:test"
import { parseLoadArgs, renderLoadReport, runLoad } from "./load.ts"

test("parallel sessions are all answered and measured", async () => {
  const report = await runLoad({ sessions: 8, prompts: 2, latencyMs: 20, mode: "ask" })
  expect(report).toMatchObject({ prompts: 16, errors: 0, sessions: 8 })
  expect(report.latencyMs.p50).toBeGreaterThan(0)
  expect(report.latencyMs.p95).toBeGreaterThanOrEqual(report.latencyMs.p50)
  expect(report.modelCalls).toBeGreaterThanOrEqual(32)
  expect(renderLoadReport(report)).toContain("| 16 | 0 |")
}, 120_000)

test("errors are counted, not thrown", async () => {
  const report = await runLoad({ sessions: 2, prompts: 1, latencyMs: 0, mode: "no-such-mode-xyz", endpoint: { baseURL: "http://127.0.0.1:1/v1", model: "m" }, timeoutMs: 20_000 })
  expect(report.errors).toBe(2)
  expect(report.bobiOverheadMs).toBeNull()
  expect(renderLoadReport(report)).toContain("Errors (first 5):")
}, 120_000)

test("command line options", () => {
  expect(parseLoadArgs([], {})).toEqual({ sessions: 20, prompts: 3, latencyMs: 200, mode: "ask", json: false })
  expect(parseLoadArgs(["--sessions", "50", "--prompts", "1", "--latency", "0", "--mode", "code", "--json"], { BOBI_LOAD_BASE_URL: "http://gw/v1", BOBI_LOAD_MODEL: "big" })).toEqual({
    sessions: 50,
    prompts: 1,
    latencyMs: 0,
    mode: "code",
    json: true,
    endpoint: { baseURL: "http://gw/v1", model: "big" },
  })
  expect(() => parseLoadArgs(["--sessions", "x"], {})).toThrow("--sessions needs a number")
})
