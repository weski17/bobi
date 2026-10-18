# ADR-0011: Testing strategy

- Status: Accepted (2026-10-19)
- Date: 2026-10-17

## Context

CLAUDE.md requires unit and integration tests, ≥ 80 % core coverage, promptfoo red-teaming, Semgrep in CI, load tests,
and a mock model endpoint so tests run without a real model. OpenCode uses `bun test` and an HTTP recorder.

## Decision

- `bun test` for all Bobi packages, coverage gate 80 % on `packages/core` and `packages/config`.
- `packages/mock-model`: scriptable OpenAI-/Anthropic-compatible server (streaming, tool calls) for deterministic tests.
- Integration tests start the engine with `@bobi/core` against the mock model.
- promptfoo suites in `tests/redteam`: injection via repo files, terminal output, web pages and MCP responses; secret exfiltration; sandbox escape.
- Semgrep and typecheck in CI (**GitHub Actions** – decided 2026-10-19). Load tests with k6 or a Bun script (to decide in Phase 1).
- COBOL tests use AWS CardDemo (Phase 6).

## Consequences

- No test needs network access or API keys.
