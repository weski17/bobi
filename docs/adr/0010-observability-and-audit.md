# ADR-0010: Observability and audit logging

- Status: Proposed
- Date: 2026-10-17

## Context

Every action must be logged with user, mode, tool and result via OpenTelemetry, forwardable to any backend such as Langfuse.
OpenCode already exports logs and traces via OTLP/HTTP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

## Decision

- Use OpenCode's built-in OTLP export; Bobi adds attributes `bobi.user`, `bobi.mode`, `bobi.tool`, `bobi.result`,
  `bobi.approval` (once/always/auto/rejected) via `tool.execute.before/after` and `permission.evaluate` hooks.
- LLM spans follow the OTel GenAI semantic conventions where possible, so Langfuse can ingest them without an adapter.
- A secret-masking processor runs before export.
- No Langfuse SDK dependency.

## Consequences

- Any OTLP backend works. Exact span names from upstream must be verified in Phase 1.
