# Status

**Current phase: 3 – MCP client and code graph** · Branch `phase-3-mcp` · waiting for approval

## Phase 3

| Task | Status | Where |
|---|---|---|
| MCP servers in config (local/remote, global/project), credentials only as `${ENV}` | ✅ | `packages/config` |
| Registration per project, individual tools (no Code Mode), OAuth off | ✅ | `packages/core/src/mcp.ts` |
| MCP per mode: `mcp` or `[mcp, { servers }]`; others denied and hidden | ✅ | `packages/modes` |
| MCP calls ask; auto-approve per server; results marked untrusted | ✅ | `tests/integration/mcp.test.ts` |
| Remote MCP server with token from the environment; missing variable disables the server | ✅ | `tests/integration/mcp.test.ts` |
| Code graph MCP server (TS/JS): symbols, callers/callees, call paths, file dependencies | ✅ | `mcp-servers/code-graph` |
| Code graph built in for every project; runs inside the sandbox | ✅ | `packages/server/src/host.ts`, `tests/sandbox` |
| Demo guide | ✅ | docs/demos/phase-3.md |

Tests: **242 pass, 0 fail** + 4 terminal-UI e2e + 6 sandbox · line coverage 99.7 % · typecheck clean.

### Phase 3 findings

1. The engine offers MCP tools only through Code Mode by default → `codemode: false`, so modes and approvals work per tool.
2. Modes with edit but without MCP could read MCP resources through the engine's `opencode_*_mcp_resource` tools
   (phase 2 rule re-allowed all `opencode_*`) → fixed.
3. MCP tools appear a moment after the server connects; the first message right after start may not offer them.

## Phase 2

| Task | Status | Where |
|---|---|---|
| Built-in modes code, plan, ask, advanced, orchestrator (engine build/plan replaced) | ✅ | `packages/modes/builtin-modes.yaml` |
| Custom modes `$BOBI_HOME/custom_modes.yaml`, `.bobi/custom_modes.yaml`; same slug overrides; reload on change | ✅ | `packages/modes` |
| Tool groups enforced: deny rules (win over auto-approve), hidden tools, `fileRegex` for edits | ✅ | `packages/modes/src/rules.ts`, `packages/core/src/plugin.ts` |
| Model per mode (was configured but ineffective since phase 1 – fixed) | ✅ | `packages/core/src/plugin.ts` |
| Rules `.bobi/rules/`, `.bobi/rules-{mode}/`, global rules, AGENTS.md | ✅ | `packages/core/src/rules.ts` |
| `/init` with Bobi's own prompt | ✅ | `packages/core/src/init.ts` |
| `.bobiignore`: file tools, search results, file-reading shell commands | ✅ | `packages/core/src/bobiignore.ts` |
| Bobi identity in the system prompt (no upstream patch) | ✅ | `packages/core/src/identity.ts` |
| Edits to `.bobi/**` and `.bobiignore` always ask | ✅ | `PROTECTED_RULES` |
| Terminal UI: starts in Code, Shift+Tab switches modes (e2e) | ✅ | `tests/e2e/tui.test.ts` |
| Demo guide | ✅ | docs/demos/phase-2.md |

Tests: **193 pass, 0 fail** + 3 terminal-UI e2e · line coverage 99.8 % · typecheck clean.

### Phase 2 findings

1. Since the phase-1 security fix (`project: false`) the engine no longer read the project's AGENTS.md → Bobi loads it.
2. The engine ignores agent models for turns → per-mode models were ineffective; fixed via the `prompt` hook.
3. The engine's plan agent injects its own reminders → its plugin is disabled; Bobi's plan mode replaces it.
4. Mode switching in the UI is Shift+Tab (the UI's own key binding).

## Phase 1

| Task | Status | Where |
|---|---|---|
| Tools installed (Bun 1.4.3, Node 24.22, Podman 6.1, ripgrep, bash 5) | ✅ | docs/DEVELOPMENT.md |
| OpenCode v2.0.32 as pinned submodule, upstream baseline green | ✅ | `vendor/opencode` |
| **Bobi as its own application** (ADR-0013): own server, own data dir `~/.bobi`, `bobi` / `run` / `serve` / `attach` | ✅ | `packages/server`, `packages/shell` |
| Bobi branding in the terminal UI (patch series, upstream TUI suite green: 1491 pass) | ✅ | `patches/opencode/` |
| Mock model endpoint (OpenAI-compatible, streaming, tool calls) | ✅ | `packages/mock-model` |
| Config: `bobi.jsonc` + env, keys only from env | ✅ | `packages/config` |
| Offline: only the model endpoint is contacted (tested) | ✅ | `tests/integration/offline.test.ts` |
| Secure permissions: every write/shell/network action asks; auto-approve only explicit | ✅ | `packages/core/defaults/permissions.jsonc` |
| Secret masking, untrusted-data marking, audit via OTLP | ✅ | `packages/core` |
| Browser tool (headless Playwright, approval per page) | ✅ | `packages/browser` |
| Checkpoints + undo in git projects | ✅ | `tests/integration/checkpoints.test.ts` |
| Checkpoints in projects without git (hidden repository + `.git` pointer) | ✅ | `packages/server/src/checkpoints.ts` |
| Sandbox: Podman container, unprivileged, internal network, egress allowlist proxy | ✅ | `sandbox/`, `packages/egress-proxy`, `tests/sandbox` |
| CI: typecheck, tests, coverage gate, terminal-UI e2e, Semgrep | ✅ green on GitHub | `.github/workflows/ci.yml` |
| Repository on GitHub (private) | ✅ | https://github.com/weski17/bobi |
| Approval prompt in the terminal UI tested by keyboard (reject / allow once) | ✅ | `tests/e2e` |
| Demo guide | ✅ | docs/demos/phase-1.md |

Tests: **143 pass, 0 fail** + 4 sandbox + 2 terminal-UI end-to-end tests · line coverage 99.7 % · typecheck clean · CI green.

## Phase 1 findings

1. OpenCode runs on without a plugin it cannot load (allow-all) → solved structurally: Bobi registers its core as a
   host plugin in its own server (ADR-0013).
2. OpenCode reads `.opencode/` from the project, including plugins (code) → disabled in the Bobi server; a cloned
   repository cannot run code in Bobi.
3. The embedded SDK ignores `OPENCODE_DISABLE_MODELS_FETCH` → `SDK_OFFLINE_OPTIONS`.
4. Without a system ripgrep, OpenCode downloads it from GitHub → prerequisite (also in the image).
5. The engine client takes the project directory from `$PWD` → Bobi sets it explicitly.
6. The egress proxy initially let keep-alive follow-up requests pass unlogged → one request per connection.
7. OpenCode's browser plugin needs its desktop app → replaced by `@bobi/browser`.
8. Snapshots are skipped when session path and git worktree differ by a symlink (macOS `/var`).

## Phase 0 (done)

Analysis, architecture and ADRs 0001–0012 – see git history and docs/adr/.

## Decisions (2026-10-19)

All ADRs 0001–0011 accepted. Open questions answered:

1. **Runtime:** install Bun and Node 24 via Homebrew in Phase 1.
2. **Upstreams:** `vendor/opencode` as submodule in Phase 1; `vendor/code-oss` only in Phase 4.
3. **Default model endpoint:** **LiteLLM** at `http://localhost:4000/v1`.
4. **Non-git projects:** auto-create a private shadow repo for checkpoints.
5. **Container runtime:** Podman (installed, VM `bobi-vm`).
6. **CI:** GitHub Actions.
7. **Browser tool:** headless Playwright (Apache-2.0).

## Open questions

1. **Logo:** waiting for the official FI SVG from the project owner (`branding/fi/icon.svg`, not committed).

### Resolved 2026-10-19

| Point | Resolution |
|---|---|
| Checkpoints without git | Hidden repository + `.git` pointer (ADR-0006) |
| License | MIT, © Finanz Informatik GmbH & Co. KG |
| Approval prompt in the UI untested | e2e test answers it by keyboard |
| Sandbox image 4.5 GB | 1.9 GB (engine packages only) |
| Terminals in the UI (WebSockets) | Bobi server on a Node HTTP server (ADR-0013 follow-up) |
| Dependency on an internal engine module | Removed; upstream proposal dropped (owner: keep internal, now unnecessary) |
| Instructions from foreign repositories | Project trust (ADR-0014) |
| `.bobiignore` bypass via shell | In the sandbox ignored paths are covered by empty mounts (ADR-0007) |
| `bobi serve` with several projects | Config per project (trusted), endpoint and model list server-wide |

## Risks

- A **trusted** project's AGENTS.md and rules still reach the model as instructions – trust is the user's decision.
- Outside the sandbox, `.bobiignore` in the terminal tool covers only common file-reading commands.
- Files matching `.bobiignore` that are created during a sandbox session are not masked until the next `up`.

- Very high upstream churn (OpenCode near-daily, V2 API not yet stable).
- IDE depends on proposed Code-OSS chat APIs.
- `.bobiignore` cannot fully stop indirect reads via shell → sandbox is the real boundary.
- Secrets inside user files end up in checkpoint snapshots.
- If a configured plugin fails to load, OpenCode falls back to allow-all. The `bobi` launcher checks this; any other
  embedding (e.g. the IDE in Phase 4) must call `verifyCore` too.
- Secret masking is pattern-based: unknown secret formats can slip through (known secret values are always masked).
- Headless Chromium runs on the host until the sandbox exists.
- The sandbox image is 1.9 GB (mostly Chromium and its system libraries).
