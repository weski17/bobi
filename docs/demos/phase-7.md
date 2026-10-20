# Demo – Phase 7: code tips, usage statistics, red team, load tests

Mock model or a real gateway as in the earlier demos.

## 1. Tests

```bash
bun run test:coverage   # incl. the red-team catalogue and a small load run
bun run test:redteam    # the same catalogue through promptfoo (Node 22+, downloads promptfoo 0.123.1 once)
bun run test:load       # 20 parallel sessions × 3 prompts against the mock (200 ms per model call)
bun run test:ide        # incl. Bobi tips as diagnostics and the "Bobi: Simplify" quick fix
```

## 2. Code tips

In Bobi IDE open a TypeScript or COBOL file with a long or deeply nested function: a yellow line with source
"Bobi" appears (complexity, length, nesting, GO TO, ALTER, …). The light bulb offers **Bobi: Simplify …** – Bobi
proposes a refactoring in the chat, shown as a diff before anything is written.

In the shell or CI:

```bash
bobi tips src                        # file:line: severity [rule] message
bobi tips --fail-on warning src      # exit code 1 if a warning is found
bobi tips vendor/carddemo/app/cbl    # COBOL: long paragraphs, GO TO, PERFORM THRU
```

Thresholds per project in `.bobi/config.jsonc`:

```jsonc
{ "tips": { "complexity": 15, "functionLines": 80, "nesting": 4, "parameters": 6 } }
```

## 3. Usage statistics

`~/.bobi/config.jsonc` (team and, optionally, the estimate for time saved):

```jsonc
{ "telemetry": { "team": "payments" }, "usage": { "minutesPerTask": 10, "minutesPerAcceptedChange": 5 } }
```

Work with Bobi for a while, then:

```bash
bobi usage --from 2026-10-01                 # per team, person, mode and day
bobi usage --team payments --format json
```

Without `usage` settings the report shows no time saved – only measured values.

## 4. Red team

`bun run test:redteam` prints one row per attack with "contained (approvals: …, executed: …)". Every attack is
performed by the (compromised) mock model; Bobi must stop it at an approval, a deny rule, `.bobiignore`, masking or
the untrusted-data marking. Against your gateway:

```bash
BOBI_REDTEAM_BASE_URL=http://localhost:4000/v1 BOBI_REDTEAM_MODEL=<model> bun run test:redteam
```

## 5. Load test

```bash
bun run test:load -- --sessions 100 --prompts 3 --latency 200
BOBI_LOAD_BASE_URL=http://localhost:4000/v1 BOBI_LOAD_MODEL=<model> bun run test:load -- --sessions 20
```
