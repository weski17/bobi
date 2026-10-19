// Audit trail (ADR-0010): every tool call and every permission decision becomes a record with
// user, mode, tool and result. Records are exported as OTLP/HTTP JSON spans so any OpenTelemetry
// backend (collector, Langfuse, ...) can ingest them. No OpenTelemetry SDK dependency.

export type AuditRecord = {
  readonly name: "bobi.tool" | "bobi.permission"
  readonly start: number
  readonly end: number
  readonly attributes: {
    readonly "bobi.user": string
    readonly "bobi.mode": string
    readonly "bobi.session": string
    readonly "bobi.tool"?: string
    readonly "bobi.action"?: string
    readonly "bobi.resources"?: string
    readonly "bobi.result": "completed" | "error" | "allow" | "ask" | "deny"
    readonly "bobi.error"?: string
  }
}

export interface AuditSink {
  record(entry: AuditRecord): void
  flush(): Promise<void>
}

export class MemorySink implements AuditSink {
  readonly records: AuditRecord[] = []
  record(entry: AuditRecord) {
    this.records.push(entry)
  }
  async flush() {}
}

const hex = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("")
const nanos = (ms: number) => `${BigInt(Math.round(ms)) * 1_000_000n}`

export type OtlpSinkOptions = {
  readonly endpoint: string
  readonly headers?: Record<string, string>
  readonly serviceVersion?: string
  /** Max records buffered before an automatic flush. */
  readonly batchSize?: number
  readonly fetch?: typeof fetch
}

/** Batches records and posts them to `<endpoint>/v1/traces` as OTLP JSON. */
export class OtlpSink implements AuditSink {
  private buffer: AuditRecord[] = []
  private readonly traceId = hex(16)
  private pending: Promise<void> = Promise.resolve()

  constructor(private readonly options: OtlpSinkOptions) {}

  record(entry: AuditRecord) {
    this.buffer.push(entry)
    if (this.buffer.length >= (this.options.batchSize ?? 32)) void this.flush()
  }

  flush(): Promise<void> {
    const batch = this.buffer
    this.buffer = []
    if (batch.length === 0) return this.pending
    this.pending = this.pending.then(() => this.send(batch))
    return this.pending
  }

  private async send(batch: AuditRecord[]) {
    const body = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: "bobi" } },
              { key: "service.version", value: { stringValue: this.options.serviceVersion ?? "0.0.0" } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: "bobi.audit" },
              spans: batch.map((entry) => ({
                traceId: this.traceId,
                spanId: hex(8),
                name: entry.name,
                kind: 1,
                startTimeUnixNano: nanos(entry.start),
                endTimeUnixNano: nanos(entry.end),
                attributes: Object.entries(entry.attributes)
                  .filter(([, v]) => v !== undefined)
                  .map(([key, v]) => ({ key, value: { stringValue: String(v) } })),
                status: { code: entry.attributes["bobi.result"] === "error" ? 2 : 1 },
              })),
            },
          ],
        },
      ],
    }
    const url = `${this.options.endpoint.replace(/\/$/, "")}/v1/traces`
    try {
      const response = await (this.options.fetch ?? fetch)(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.options.headers },
        body: JSON.stringify(body),
      })
      if (!response.ok) console.error(`bobi audit: OTLP export failed with HTTP ${response.status}`)
    } catch (error) {
      // Audit export must never break a session; the failure itself is reported locally.
      console.error(`bobi audit: OTLP export failed: ${(error as Error).message}`)
    }
  }
}

/** Parses OTEL_EXPORTER_OTLP_HEADERS ("k1=v1,k2=v2"). */
export function parseOtlpHeaders(value: string | undefined): Record<string, string> {
  if (!value) return {}
  return Object.fromEntries(
    value
      .split(",")
      .map((pair) => pair.split("="))
      .filter((parts) => parts.length >= 2 && parts[0]!.trim())
      .map(([k, ...v]) => [decodeURIComponent(k!.trim()), decodeURIComponent(v.join("=").trim())]),
  )
}
