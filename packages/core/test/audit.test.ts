import { afterEach, describe, expect, test } from "bun:test"
import { type AuditRecord, MemorySink, OtlpSink, parseOtlpHeaders } from "../src/audit.ts"

const record = (result: AuditRecord["attributes"]["bobi.result"] = "completed"): AuditRecord => ({
  name: "bobi.tool",
  start: 1_700_000_000_000,
  end: 1_700_000_000_250,
  attributes: { "bobi.user": "alice", "bobi.mode": "code", "bobi.session": "ses_1", "bobi.tool": "write", "bobi.result": result },
})

let server: ReturnType<typeof Bun.serve> | undefined
afterEach(() => {
  server?.stop(true)
  server = undefined
})

function collector(status = 200) {
  const received: { headers: Headers; body: any }[] = []
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      received.push({ headers: request.headers, body: await request.json() })
      return new Response(null, { status })
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, received }
}

describe("audit sinks", () => {
  test("memory sink keeps records", async () => {
    const sink = new MemorySink()
    sink.record(record())
    await sink.flush()
    expect(sink.records).toHaveLength(1)
  })

  test("OTLP sink posts spans with Bobi attributes to /v1/traces", async () => {
    const otel = collector()
    const sink = new OtlpSink({ endpoint: `${otel.url}/`, headers: { "x-api-key": "k" }, serviceVersion: "1.2.3" })
    sink.record(record())
    sink.record(record("error"))
    await sink.flush()
    expect(otel.received).toHaveLength(1)
    expect(otel.received[0]!.headers.get("x-api-key")).toBe("k")
    const resource = otel.received[0]!.body.resourceSpans[0]
    expect(resource.resource.attributes).toContainEqual({ key: "service.name", value: { stringValue: "bobi" } })
    const spans = resource.scopeSpans[0].spans
    expect(spans).toHaveLength(2)
    expect(spans[0].name).toBe("bobi.tool")
    expect(spans[0].startTimeUnixNano).toBe("1700000000000000000")
    expect(spans[0].endTimeUnixNano).toBe("1700000000250000000")
    expect(spans[0].traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(spans[0].spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(spans[0].attributes).toContainEqual({ key: "bobi.user", value: { stringValue: "alice" } })
    expect(spans[0].status.code).toBe(1)
    expect(spans[1].status.code).toBe(2)
  })

  test("flushes automatically when the batch is full, and an empty flush sends nothing", async () => {
    const otel = collector()
    const sink = new OtlpSink({ endpoint: otel.url, batchSize: 2 })
    await sink.flush()
    sink.record(record())
    sink.record(record())
    await sink.flush()
    expect(otel.received).toHaveLength(1)
  })

  test("export failures never throw", async () => {
    const otel = collector(500)
    const errors: string[] = []
    const original = console.error
    console.error = (msg: string) => void errors.push(msg)
    try {
      const failing = new OtlpSink({ endpoint: otel.url })
      failing.record(record())
      await failing.flush()
      const unreachable = new OtlpSink({ endpoint: "http://127.0.0.1:1" })
      unreachable.record(record())
      await unreachable.flush()
    } finally {
      console.error = original
    }
    expect(errors.some((e) => e.includes("HTTP 500"))).toBe(true)
    expect(errors.some((e) => e.includes("export failed:"))).toBe(true)
  })

  test("parses OTEL_EXPORTER_OTLP_HEADERS", () => {
    expect(parseOtlpHeaders(undefined)).toEqual({})
    expect(parseOtlpHeaders("Authorization=Basic%20abc==, x-team = core ,broken")).toEqual({ Authorization: "Basic abc==", "x-team": "core" })
  })
})
