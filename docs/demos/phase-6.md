# Demo – Phase 6: COBOL, mainframe, autocomplete, audit reports, diagrams, A2A

Mock model or a real gateway as in the earlier demos. CardDemo is checked out with
`git submodule update --init --depth 1 vendor/carddemo`.

## 1. Tests

```bash
bun run test:coverage   # incl. COBOL against CardDemo, mainframe against the mock, A2A end to end
bun run test:ide        # incl. autocomplete ghost text accepted with Tab
bun run test:sandbox    # incl. the COBOL server inside the container
```

## 2. COBOL analysis (Advanced mode)

```bash
cd vendor/carddemo && bobi --trust
```

Switch to **Advanced** and ask, for example:

- "Which programs and jobs are affected if the copybook CVACT01Y changes?" → `cobol_impact`
- "Where does ACCT-CURR-BAL in CBACT01C end up?" → `cobol_data_flow`
- "Which screens does the sign-on program lead to?" → `cobol_program_calls`
- "Which jobs use the datasets AWS.M2.CARDDEMO.ACCTDATA.*?" → `cobol_impact` with `dataset`

Each MCP call asks (or auto-approve `cobol_*` in `.bobi/config.jsonc`).

## 3. Diagrams

```bash
bobi diagram cobol vendor/carddemo                     # programs, XCTL/CALL edges, JCL jobs
bobi diagram cobol --program CBACT01C vendor/carddemo  # PERFORM graph of one program
bobi diagram --depth 2                                 # import graph of a TypeScript project
```

Paste the output into any Mermaid viewer (or a Markdown file).

## 4. Mainframe (mock)

```bash
export ZOWE_OPT_HOST=127.0.0.1 ZOWE_OPT_PORT=7554 ZOWE_OPT_PROTOCOL=http ZOWE_OPT_USER=dev1
export ZOWE_OPT_PASSWORD=$(openssl rand -hex 12)
bun -e 'import { startMockMainframe } from "./mcp-servers/zowe/src/index.ts"
const m = startMockMainframe({ user: "dev1", password: process.env.ZOWE_OPT_PASSWORD!, port: 7554 })
m.datasets.set("DEV1.COBOL.SRC(PAYCALC)", "       PROGRAM-ID. PAYCALC.\n")
m.datasets.set("PROD.PAYROLL", "production data")' &
bobi
```

In Advanced mode: "Show DEV1.COBOL.SRC(PAYCALC)" works; "read PROD.PAYROLL" is refused (outside
`BOBI_ZOWE_DATASETS`, default `DEV1.**`). Writing a member or submitting a job always asks, even with
`autoApprove` for `zowe_*`. A real system: a Zowe profile (`zowe.config.json`) or `ZOWE_OPT_*`, and in the sandbox
the host in `BOBI_EGRESS_ALLOW`.

## 5. Autocomplete in Bobi IDE

`~/.bobi/config.jsonc`:

```jsonc
{ "model": { "models": ["qwen2.5-coder"] }, "autocomplete": { "model": "qwen2.5-coder" } }
```

Restart Bobi in the IDE (Bobi: Restart Server), type in a file – grey suggestions appear, Tab accepts.
Files in `.bobiignore` get no suggestions. Without `autocomplete.model` nothing is sent.

## 6. Audit report

```bash
bobi audit --from 2026-10-01 > audit.md
bobi audit --user anna --format json
```

The report lists users, modes, tools, policy decisions, the user's answers (approved/rejected), every action that
left the project (terminal, network, MCP, mainframe) and all rejected or denied actions.

## 7. A2A

```bash
export BOBI_A2A_TOKEN="$(openssl rand -base64 32)"
BOBI_A2A=1 BOBI_SERVER_PASSWORD=<16+ chars> bobi serve --port 4096
curl -s http://127.0.0.1:4096/.well-known/agent-card.json
curl -s -H "Authorization: Bearer $BOBI_A2A_TOKEN" http://127.0.0.1:4096/a2a -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"message/send",
  "params":{"message":{"kind":"message","role":"user","messageId":"m1","parts":[{"kind":"text","text":"What does app.ts do?"}]}}}'
```

The other agent gets a read-only answer; requests to write or run commands are denied immediately.
Calling other agents: list them in `a2a.agents` (token as `${ENV}`), then in Advanced mode "ask the tickets agent
who owns TICKET-7" – Bobi asks before every call.
