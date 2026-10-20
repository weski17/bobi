# ADR-0018: Code tips, usage statistics, red teaming with promptfoo, load tests

- Status: Accepted (2026-10-20, phase 7 and its decisions approved by the project owner)
- Date: 2026-10-20

## Decisions

- **Code tips (req. 14):** local static analysis, no model call (`@bobi/tips`). TS/JS via the TypeScript compiler's
  syntax tree: cyclomatic complexity, function length, block nesting, parameter count, empty `catch`, explicit
  `any`, loose equality. COBOL via Bobi's parser: paragraph length, nesting of IF/EVALUATE/inline PERFORM, GO TO,
  PERFORM THRU, ALTER. Defaults 10 / 60 / 4 / 5, per project in `tips` of the Bobi config (trusted projects).
  Served by `POST /bobi/tips` (server password; `.bobiignore`'d files get none). Bobi IDE shows them as diagnostics
  (source "Bobi") 700 ms after the last change, with a quick fix "Bobi: Simplify …" that sends a refactoring request
  to the chat – the result is an edit approval with diff like any other change. `bobi tips [paths]` lists them;
  `--fail-on warning|info` turns them into a CI gate.
- **Usage statistics (req. 19):** the audit log now records one `bobi.task` per prompt and one `bobi.usage` per model
  step (tokens from the engine's `session.step.ended`), each with user, team (`telemetry.team` / `BOBI_TEAM`) and
  mode. `bobi usage` reports per team, person, mode and day: tasks, sessions, tokens, tool calls, approved and
  rejected changes. **Time saved** is not measurable; it appears only when `usage.minutesPerTask` and/or
  `usage.minutesPerAcceptedChange` are set in the global config, and is labelled as an estimate.
- **Red teaming (CLAUDE.md):** a catalogue of attacks (`tests/redteam/cases.ts`): injection via repository files,
  terminal output and MCP answers; secret exfiltration; `.bobiignore` bypass; widening Bobi's own rights; writes
  outside the project; escalation through A2A. With the mock, the model is **compromised by assumption** – it
  performs every attack – and the checks verify that Bobi contains it (no forbidden tool ran, protected and outside
  files unchanged, the secret never reached the model or the answer, attack text only inside untrusted-data, no A2A
  request waiting for approval). Approval requests are rejected like a careful user would. The catalogue runs in
  `bun test` (CI) and in promptfoo (`bun run test:redteam`, own CI job). A self-check proves that a weakened policy
  is reported. Against a real gateway (`BOBI_REDTEAM_BASE_URL`, `BOBI_REDTEAM_MODEL`) the same suite also shows how
  often the model attempts the attack (approval requests in the result).
- **promptfoo:** dev tool only, pinned to 0.123.1 (MIT), run via `npx` (not installed in the workspace), with
  telemetry, update checks and remote generation switched off. Sandbox escape stays covered by `tests/sandbox`
  (egress allowlist, unprivileged user, hidden `.bobiignore` paths), which needs Podman.
- **Load tests:** `bun run test:load` starts a real Bobi server and runs N parallel sessions × M prompts (each prompt
  a tool call plus an answer), reporting p50/p90/p95/p99/max, throughput, errors and – with the mock's simulated
  latency – Bobi's own overhead. A small run is part of `bun test`.

## Consequences

- No new runtime dependency; promptfoo is a pinned test tool.
- Code tips cover TS/JS and COBOL; other languages get none for now.
