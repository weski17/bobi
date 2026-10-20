# ADR-0017: COBOL and mainframe MCP servers, autocomplete, audit reports, diagrams, A2A

- Status: Accepted (2026-10-19, phase 6 plan and the four open decisions approved by the project owner)
- Date: 2026-10-19

## Decisions

- **COBOL analysis (req. 16):** own MCP server `mcp-servers/cobol`, built in for every project like the code graph.
  Own parser, no new dependency: reference format (fixed, free, continuation lines), `COPY … REPLACING` on text
  (partial-word pseudo-text as used by CardDemo), `EXEC SQL INCLUDE`, data items (levels, groups, `PIC`, `USAGE`,
  `OCCURS`, `REDEFINES`, 88-levels), paragraphs and sections, `PERFORM`/`GO TO`, `CALL` (dynamic via `VALUE`),
  `EXEC CICS LINK/XCTL`, `SELECT … ASSIGN`, and JCL steps with DD datasets. Tools: `list_programs`, `find`,
  `program_outline`, `performs`, `program_calls`, `field`, `data_flow`, `impact` (copybook, program, field, dataset),
  `diagram`. Read-only; results are untrusted data like any MCP output. Test object: AWS CardDemo (Apache-2.0) as
  submodule `vendor/carddemo`, tests and demos only.
- **Mainframe access (req. 16):** own MCP server `mcp-servers/zowe` over the mainframe's REST file and job services –
  the API the Zowe CLI uses – instead of the Zowe Node SDK (EPL-2.0, large dependency tree). It reads Zowe team
  configuration (`zowe.config.json`, `zowe.config.user.json`, project before `~/.zowe`) and the standard `ZOWE_OPT_*`
  variables; the password comes from the environment only. Registered only when a connection is configured.
  **Production data:** datasets and USS paths are limited to an allowlist (`BOBI_ZOWE_DATASETS`, `BOBI_ZOWE_USS`;
  default: the user's own high-level qualifier and home directory); DSN references in submitted JCL are checked too.
  `zowe_write_dataset` and `zowe_submit_job` are protected rules: they always ask, even with auto-approval.
  Certificates are always verified: `rejectUnauthorized: false` (allowed by the Zowe CLI) is refused; a company CA
  is added with `NODE_EXTRA_CA_CERTS`.
- **Autocomplete (req. 17):** `POST /bobi/complete` on the Bobi server: fill-in-the-middle via
  `<baseURL>/completions` (prompt + suffix; vLLM, Ollama, LiteLLM). Off until `autocomplete.model` is set; the model
  must be declared in the server's model list; OpenAI-compatible endpoints only. The server refuses `.bobiignore`'d
  files, masks secrets in prefix/suffix/answer and keeps the API key. Bobi IDE shows ghost text (debounced,
  cancellable, stops asking after the server reports "off"). Setting `bobi.autocomplete.enabled` turns it off locally.
- **Audit reports and diagrams (req. 18):** audit records also go to `~/.bobi/audit/<day>.jsonl` (owner-only,
  masked, `telemetry.auditLog: false` turns it off) and include the user's answer to each approval
  (`bobi.approval`: once/always/reject, from the engine's `permission.replied` event). `bobi audit` renders a Markdown
  or JSON report (users, modes, tools, policy decisions, answers, actions outside the project, rejections).
  `bobi diagram` prints Mermaid from the code graph (files or directories) or the COBOL index (system call graph
  with jobs, or one program's PERFORM graph); both servers offer the same as a `diagram` tool.
- **A2A (req. 20):** protocol version 0.3 (open specification), JSON-RPC binding. Inbound is off by default and can be
  enabled only in the global config or with `BOBI_A2A=1` – never by a project. Agent card at
  `/.well-known/agent-card.json` (public), JSON-RPC at `/a2a` (server password, HTTP Basic): `message/send`,
  `tasks/get`, `tasks/cancel`; no streaming or push notifications. Tasks run in the hidden engine agent `a2a`: the
  built-in Ask mode (not overridable by project or global modes), no auto-approvals, only read/glob/grep/skill;
  `@bobi/core` turns every other permission evaluation and every "ask" into "deny", so nothing waits for an approval.
  Because the restriction belongs to the agent, it survives server restarts. Outbound: the `a2a` tool calls agents
  listed in `a2a.agents` (credentials as `${ENV}`), only in modes with the mcp group, always asks; the card's
  endpoint must be on the configured origin.
- **Server routes:** `@bobi/server` gained a small route hook next to the engine API (`public` / `private` with the
  server password) for `/bobi/complete`, the agent card and `/a2a`. No engine change.

## Names and trademarks

Product names of the mainframe vendor do not appear in UI texts or tool descriptions ("mainframe", "online",
"EXEC block"). REST paths and protocol headers the services require (`/zosmf/…`, `X-CSRF-ZOSMF-HEADER`, `X-IBM-*`)
and COBOL syntax (`EXEC CICS`, `EXEC SQL`) appear only in code as technical identifiers.

## Consequences

- No new third-party dependency; CardDemo is a test object only (LICENSES.md).
- The COBOL parser covers the CardDemo dialect, not every compiler extension (see STATUS risks).
- The mainframe server is tested against an in-memory mock of the REST services, not a real system.

## Not in this phase

- Usage statistics per team/person (req. 19) and code tips while typing (req. 14).
