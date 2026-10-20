#!/usr/bin/env bun
// Load test (CLAUDE.md): many parallel sessions against the configured model endpoint, measuring response times.
// Each prompt is a realistic loop: the model reads a file (tool call), then answers. Default: mock model with
// simulated latency, so Bobi's own overhead becomes visible. Real endpoint: BOBI_LOAD_BASE_URL + BOBI_LOAD_MODEL.
//   bun tests/load/load.ts [--sessions 20] [--prompts 3] [--latency 200] [--mode ask] [--json]
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { DEFAULTS } from "@bobi/config"
import { MemorySink } from "@bobi/core"
import { startMockModel, type ChatRequest } from "@bobi/mock-model"
import { bobiPaths, startBobiServer } from "@bobi/server"

export type LoadOptions = {
  readonly sessions: number
  readonly prompts: number
  /** Simulated model latency per call (mock only). */
  readonly latencyMs: number
  readonly mode: string
  /** Real endpoint instead of the mock. */
  readonly endpoint?: { baseURL: string; model: string }
  readonly timeoutMs?: number
}

export type LoadReport = {
  readonly endpoint: string
  readonly sessions: number
  readonly promptsPerSession: number
  readonly prompts: number
  readonly errors: number
  readonly errorSamples: string[]
  readonly durationMs: number
  readonly throughputPerMinute: number
  readonly latencyMs: { p50: number; p90: number; p95: number; p99: number; max: number; mean: number }
  readonly modelCalls: number | null
  /** Mean time per prompt not spent waiting for the (simulated) model; mock only. */
  readonly bobiOverheadMs: number | null
}

const percentile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]! : 0)

export async function runLoad(options: LoadOptions): Promise<LoadReport> {
  const home = mkdtempSync(path.join(tmpdir(), "bobi-load-home-"))
  const project = realpathSync(mkdtempSync(path.join(tmpdir(), "bobi-load-proj-")))
  writeFileSync(path.join(project, "service.ts"), "export function handle(request: Request) {\n  return new Response('ok')\n}\n")
  const file = path.join(project, "service.ts")
  // Mock: first call of a prompt reads the file, the call after the tool result answers.
  const mock = options.endpoint
    ? undefined
    : startMockModel({
        latencyMs: options.latencyMs,
        fallback: (request: ChatRequest) =>
          request.messages.at(-1)?.role === "tool" ? { text: "The service answers every request with ok." } : { toolCalls: [{ name: "read", arguments: { path: file } }] },
      })
  const password = crypto.randomUUID()
  const server = await startBobiServer({
    config: {
      ...structuredClone(DEFAULTS),
      model: { ...DEFAULTS.model, baseURL: options.endpoint?.baseURL ?? mock!.baseURL, default: options.endpoint?.model ?? "mock-model" },
      telemetry: { user: "load-test", auditLog: false },
    },
    paths: bobiPaths({ BOBI_HOME: home }),
    password,
    audit: new MemorySink(),
    browser: false,
    env: { BOBI_HOME: home, HOME: home, BOBI_MODEL_API_KEY: process.env.BOBI_MODEL_API_KEY ?? "load-test" },
  })
  const auth = { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`, "content-type": "application/json" }
  const call = async (method: string, route: string, body?: unknown) => {
    const response = await fetch(`${server.url}${route}`, { method, headers: auth, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(options.timeoutMs ?? 300_000) })
    if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status}`)
    const text = await response.text()
    return text ? (JSON.parse(text) as { data?: unknown }) : undefined
  }

  const latencies: number[] = []
  const errors: string[] = []
  const started = performance.now()
  try {
    await Promise.all(
      Array.from({ length: options.sessions }, async (_, s) => {
        let sessionID: string
        try {
          sessionID = ((await call("POST", "/api/session", { location: { directory: project }, agent: options.mode }))!.data as { id: string }).id
        } catch (error) {
          errors.push(`session ${s}: ${(error as Error).message}`)
          return
        }
        for (let p = 0; p < options.prompts; p++) {
          const t0 = performance.now()
          try {
            await call("POST", `/api/session/${sessionID}/prompt`, { text: `What does service.ts do? (${s}/${p})` })
            await call("POST", `/api/experimental/session/${sessionID}/wait`)
            const messages = (await call("GET", `/api/session/${sessionID}/message?order=asc`))!.data as { type: string; content?: { type: string; text?: string }[] }[]
            const last = messages.findLast((m) => m.type === "assistant" && m.content?.some((c) => c.type === "text" && c.text))
            if (!last) throw new Error("no answer")
            latencies.push(performance.now() - t0)
          } catch (error) {
            errors.push(`session ${s} prompt ${p}: ${(error as Error).message}`)
          }
        }
      }),
    )
  } finally {
    await server.stop()
    await mock?.stop()
    rmSync(home, { recursive: true, force: true })
    rmSync(project, { recursive: true, force: true })
  }
  const durationMs = performance.now() - started
  const sorted = [...latencies].sort((a, b) => a - b)
  const mean = sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0
  const total = options.sessions * options.prompts
  // Agent-loop calls only (auxiliary calls such as session titles are not part of a prompt's critical path).
  const loopCalls = mock ? mock.requests.filter((r) => (r.body.tools?.length ?? 0) > 0).length : null
  const round = (n: number) => Math.round(n)
  return {
    endpoint: options.endpoint ? `${options.endpoint.baseURL} (${options.endpoint.model})` : `mock model, ${options.latencyMs} ms per call`,
    sessions: options.sessions,
    promptsPerSession: options.prompts,
    prompts: total,
    errors: errors.length,
    errorSamples: errors.slice(0, 5),
    durationMs: round(durationMs),
    throughputPerMinute: round((latencies.length / durationMs) * 60_000),
    latencyMs: { p50: round(percentile(sorted, 50)), p90: round(percentile(sorted, 90)), p95: round(percentile(sorted, 95)), p99: round(percentile(sorted, 99)), max: round(sorted.at(-1) ?? 0), mean: round(mean) },
    modelCalls: mock ? mock.requests.length : null,
    bobiOverheadMs: loopCalls !== null && latencies.length ? Math.max(0, round(mean - (loopCalls / latencies.length) * options.latencyMs)) : null,
  }
}

export function renderLoadReport(r: LoadReport): string {
  return [
    "# Bobi load test",
    "",
    `Endpoint: ${r.endpoint}. ${r.sessions} parallel sessions × ${r.promptsPerSession} prompts (each prompt: tool call + answer).`,
    "",
    "| Prompts | Errors | Duration | Throughput | p50 | p90 | p95 | p99 | max | Bobi overhead (mean) |",
    "|---|---|---|---|---|---|---|---|---|---|",
    `| ${r.prompts} | ${r.errors} | ${(r.durationMs / 1000).toFixed(1)} s | ${r.throughputPerMinute}/min | ${r.latencyMs.p50} ms | ${r.latencyMs.p90} ms | ${r.latencyMs.p95} ms | ${r.latencyMs.p99} ms | ${r.latencyMs.max} ms | ${r.bobiOverheadMs === null ? "–" : `${r.bobiOverheadMs} ms`} |`,
    ...(r.errorSamples.length ? ["", "Errors (first 5):", ...r.errorSamples.map((e) => `- ${e}`)] : []),
    "",
  ].join("\n")
}

export function parseLoadArgs(argv: readonly string[], env: Record<string, string | undefined> = process.env): LoadOptions & { json: boolean } {
  const value = (flag: string, def: number, max: number) => {
    const i = argv.indexOf(flag)
    if (i < 0) return def
    const n = Number(argv[i + 1])
    if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`${flag} needs a number between 0 and ${max}`)
    return n
  }
  const mode = argv.includes("--mode") ? argv[argv.indexOf("--mode") + 1] ?? "ask" : "ask"
  return {
    sessions: value("--sessions", 20, 1000),
    prompts: value("--prompts", 3, 100),
    latencyMs: value("--latency", 200, 60_000),
    mode,
    json: argv.includes("--json"),
    ...(env.BOBI_LOAD_BASE_URL && env.BOBI_LOAD_MODEL ? { endpoint: { baseURL: env.BOBI_LOAD_BASE_URL, model: env.BOBI_LOAD_MODEL } } : {}),
  }
}

if (import.meta.main) {
  const options = parseLoadArgs(process.argv.slice(2))
  const report = await runLoad(options)
  console.log(options.json ? JSON.stringify(report, null, 2) : renderLoadReport(report))
  process.exit(report.errors ? 1 : 0)
}
