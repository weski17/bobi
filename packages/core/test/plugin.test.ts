import { expect, test } from "bun:test"
import { DEFAULTS } from "@bobi/config"
import { defaultSink, MemorySink, OtlpSink } from "../src/index.ts"

test("audit goes to OTLP when an endpoint is configured, else to memory", () => {
  expect(defaultSink(DEFAULTS)).toBeInstanceOf(MemorySink)
  const sink = defaultSink({ ...DEFAULTS, telemetry: { otlpEndpoint: "http://otel:4318" } }, { OTEL_EXPORTER_OTLP_HEADERS: "a=b" })
  expect(sink).toBeInstanceOf(OtlpSink)
})
