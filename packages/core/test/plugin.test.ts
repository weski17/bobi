import { expect, test } from "bun:test"
import { DEFAULTS } from "@bobi/config"
import { defaultSink, MemorySink, OtlpSink } from "../src/index.ts"

test("audit goes to OTLP when an endpoint is configured, else to memory", () => {
  expect(defaultSink(DEFAULTS)).toBeInstanceOf(MemorySink)
  const sink = defaultSink({ ...DEFAULTS, telemetry: { otlpEndpoint: "http://otel:4318" } }, { OTEL_EXPORTER_OTLP_HEADERS: "a=b" })
  expect(sink).toBeInstanceOf(OtlpSink)
})

test("localTitle: first line of the first user message, cleaned and shortened", async () => {
  const { localTitle } = await import("../src/index.ts")
  expect(localTitle([{ role: "user", content: "  Lies **src/checkout.ts**\nund erkläre sie" }])).toBe("Lies src/checkout.ts")
  expect(localTitle([{ role: "user", content: [{ type: "text", text: "# Rabattcodes\nmehr" }] }])).toBe("Rabattcodes")
  expect(localTitle([{ content: [{ type: "text", text: "Ohne Rolle" }] }])).toBe("Ohne Rolle")
  const long = localTitle([{ role: "user", content: "wort ".repeat(30) }])!
  expect(long.length).toBeLessThanOrEqual(58)
  expect(long.endsWith("…")).toBe(true)
  expect(localTitle([{ role: "assistant", content: "x" }])).toBeUndefined()
  expect(localTitle([{ role: "user", content: "   \n  " }])).toBeUndefined()
  expect(localTitle([{ role: "user", content: [{ type: "file" }, null, { type: "text", text: "" }] }])).toBeUndefined()
  expect(localTitle([])).toBeUndefined()
})
