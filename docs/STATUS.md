# Status

**Phase 7 done – all requirements 1–20 of CLAUDE.md implemented.** · `main` · user handbook: [HANDBUCH.md](HANDBUCH.md)

## After phase 7 (2026-10-20)

| Task | Status | Where |
|---|---|---|
| Feature tour video (3:37, 24 chapters, subtitles, narration) and 30 s intro | ✅ | `docs/media/` |
| Narration with a freely licensed voice (Piper, Thorsten: model MIT, data CC0) instead of the macOS voice | ✅ | `docs/media/bobi-tour/make.ts` |
| German user handbook | ✅ | `docs/HANDBUCH.md` |
| README as product page, architecture updated to the built system, `AGENTS.md` for the repository | ✅ | `README.md`, `docs/ARCHITECTURE.md`, `AGENTS.md` |
| Full check: typecheck, 397 tests, e2e, IDE, sandbox, red team, Semgrep, load, CLI walkthrough | ✅ | 2026-10-20 |
| Docker Compose setup (server, egress allowlist, gateway, demo model), `.bobiignore` masks, e2e test | ✅ | `compose.yaml`, `sandbox/`, ADR-0019 |
| Multi-platform image (amd64 + arm64) to GitHub Packages, private, built by GitHub Actions | ✅ | `.github/workflows/image.yml` |
| Demo image with bundled model (Ollama + Qwen3 4B), web terminal, sample project; no internet in the container | ✅ | `sandbox/Containerfile` (target `demo`), `sandbox/demo/`, `compose.demo.yaml`, ADR-0020 |
| CI builds both images, tests the demo end to end (incl. a real agent turn) before publishing `latest`; CD workflow deploys over SSH | ✅ | `.github/workflows/image.yml`, `deploy.yml` |

## Phase 7

| Task | Status | Where |
|---|---|---|
| Code tips TS/JS (complexity, length, nesting, parameters, empty catch, `any`, `==`) and COBOL (paragraph length, nesting, GO TO, PERFORM THRU, ALTER) | ✅ | `packages/tips` |
| Tips in Bobi IDE as diagnostics + "Bobi: Simplify" quick fix (diff before apply); `bobi tips` with CI gate | ✅ | `packages/ide-extension`, `packages/server/src/tips.ts`, `packages/shell` |
| Usage per person, team, mode, day: tasks, tokens, tool calls, approved/rejected changes; time saved only as configured estimate | ✅ | `packages/core/src/usage.ts`, `bobi usage` |
| Red team: 8 attacks against a compromised mock model, in `bun test` and promptfoo; self-check | ✅ | `tests/redteam` |
| Load test: parallel sessions, p50–p99, throughput, Bobi overhead | ✅ | `tests/load` |
| Demo guide | ✅ | docs/demos/phase-7.md |

Tests: **397 pass, 0 fail** + promptfoo red team 8/8 + IDE integration test (incl. tips) + e2e + sandbox.

### Phase 7 findings

1. Load (mock, 200 ms per model call): 20 sessions × 3 prompts → p95 ≈ 1.0 s, Bobi overhead ≈ 0.4 s per prompt;
   100 sessions → p95 ≈ 2.2 s, overhead ≈ 1.1 s, 0 errors. All sessions share one engine process; for larger teams,
   one server per team or user (as today: one per IDE workspace) keeps the overhead low.
2. `bobi tips` on Bobi itself flagged three A2A functions → refactored. Other long functions in Bobi's own code
   (e.g. the core plugin's setup, the COBOL parser) are known and listed by `bobi tips packages mcp-servers`.
3. promptfoo's `exec:` provider runs in the config's directory; it is called with the case id from the test vars.
4. The approval request of a fetch shows the full URL including what the model put into it; the token in the test
   never reached the model (masked), so only a fully compromised model could have built that URL.


## Phase 6

| Task | Status | Where |
|---|---|---|
| COBOL MCP server: own parser (COPY REPLACING, data items, PERFORM, CALL/LINK/XCTL, EXEC blocks, JCL) | ✅ | `mcp-servers/cobol` |
| COBOL tools: outline, call graphs, field data flow, impact of copybook / program / field / dataset | ✅ | same, tested on AWS CardDemo (`vendor/carddemo`) |
| Mainframe MCP server over the Zowe-compatible REST services; Zowe profiles, password only from env | ✅ | `mcp-servers/zowe` |
| Dataset/USS allowlist (default: own datasets), DSNs in submitted JCL checked, writes and jobs always ask | ✅ | same, `PROTECTED_RULES` |
| Autocomplete: `/bobi/complete` (FIM), off until `autocomplete.model`; ghost text in Bobi IDE | ✅ | `packages/server/src/complete.ts`, `packages/ide-extension` |
| Local audit log incl. the user's answers; `bobi audit` report (Markdown/JSON) | ✅ | `packages/core/src/{audit,report}.ts`, `packages/shell` |
| Architecture diagrams (Mermaid): `bobi diagram`, `diagram` MCP tools | ✅ | code graph, COBOL server |
| A2A: agent card, read-only inbound tasks (`a2a` agent), outbound `a2a` tool with approval | ✅ | `packages/a2a`, `packages/core` |
| Sandbox passes mainframe/A2A settings; mounted repos git-safe | ✅ | `sandbox/bobi-sandbox.sh` |
| Demo guide | ✅ | docs/demos/phase-6.md |

Tests: **369 pass, 0 fail** (line coverage 98.4 %) + IDE integration test (incl. autocomplete) + 5 terminal-UI e2e
+ 7 sandbox (incl. the COBOL server in the container).

### Phase 6 findings

1. CardDemo uses partial-word `COPY … REPLACING ==(TESTVAR1)== BY ==…==` → replacement on text before tokenising.
2. Continued literals run to column 72; editors strip trailing spaces → the area is padded before joining.
3. Without an answer record the audit could not show whether the user approved or rejected → `permission.replied`
   is now audited (`bobi.approval`).
4. An A2A task in a mode that asks would wait forever (nobody answers) → the `a2a` agent turns every "ask" into
   "deny"; the restriction is tied to the agent, so it also holds after a restart.
5. A project could otherwise override the Ask mode or enable inbound A2A → the `a2a` agent always uses the built-in
   Ask mode, and `a2a.enabled` in a project config is an error.
6. In the Podman VM a bind-mount root can appear as owned by root; git then refused the project (also checkpoints)
   → only the project and the checkpoint directory are declared `safe.directory`.
7. Inline suggestions only render in a focused editor → the IDE test focuses the editor group first.

## Phase 5

| Task | Status | Where |
|---|---|---|
| Orchestrator delegates to Bobi modes (subagents); subtask approvals reach the user (TUI, IDE) | ✅ | `packages/core`, `src/controller.ts` |
| Security mode + `/security-review` | ✅ | `packages/modes/builtin-modes.yaml`, `defaults/commands` |
| Skills (`SKILL.md`) global and per project (trusted) | ✅ | `packages/core/src/extensions.ts` |
| Own slash commands (`.bobi/commands/*.md`, mode + `$ARGUMENTS`) | ✅ | same |
| Git: `/commit`, `/pr`; read-only git without asking; IDE commit message button | ✅ | `defaults/commands`, `permissions.jsonc` |
| Literate coding in the IDE (Cmd+Alt+Enter) with diff review | ✅ | `packages/ide-extension` |
| Shell: `bobi modes`, `bobi run --mode` | ✅ | `packages/shell` |
| Engine's own skills (vendor docs/issue reporting) disabled | ✅ | `DISABLED_PLUGINS` |
| Demo guide | ✅ | docs/demos/phase-5.md |

Tests: **290 pass, 0 fail** + IDE integration test (incl. literate coding, commit button) + 5 terminal-UI e2e + 6 sandbox.

### Phase 5 findings

1. The engine shipped skills that point the model at the vendor's online documentation → disabled.
2. A direct model call for commit messages would bypass secret masking → done through a short session instead.
3. Skills and commands steer Bobi too → now part of the project trust fingerprint.
4. In the IDE an approval from a subtask would have been invisible → child sessions are tracked.

## Phase 4

| Task | Status | Where |
|---|---|---|
| Code-OSS 1.141.2 as pinned submodule, builds from source on macOS | ✅ | `vendor/code-oss`, `bun run ide:setup` |
| Branding "Bobi IDE" (name, ids, icon, branding pack), Copilot/outbound product keys removed | ✅ | `scripts/ide/brand.ts` |
| Two minimal Code-OSS patches (Copilot onboarding, default account) | ✅ | `patches/code-oss/` |
| Chat panel (webview): streaming, modes, new chat, stop, undo | ✅ | `packages/ide-extension` |
| Server per workspace, project trust dialog (`bobi trust`) | ✅ | `src/server.ts`, `packages/shell` |
| Context from open tabs and selection | ✅ | `src/context.ts` |
| Diff before apply: proposal in the diff editor, written only after Accept | ✅ | `src/diff.ts`, `src/patch.ts` |
| Integration test inside the real IDE (diff, accept, write, undo) | ✅ | `tests/ide`, `bun run test:ide` |
| Built-in Copilot chat features off; idle IDE opens no outbound connections (measured) | ✅ | ADR-0008 |
| Packaged `Bobi IDE.app` | ⏳ blocked: Code-OSS bundles proprietary Copilot packages | ADR-0008, open questions |
| Demo guide | ✅ | docs/demos/phase-4.md |

Tests: **271 pass, 0 fail** + IDE integration test + 4 terminal-UI e2e + 6 sandbox · line coverage 99.6 %.

### Phase 4 findings

1. Removing `product.defaultChatAgent` crashed the workbench (onboarding, default account) → two small patches.
2. `builtInExtensionsEnabledWithAutoUpdates` must exist (empty list) or no extension loads.
3. Code-OSS 1.141 depends on proprietary GitHub Copilot packages and starts a local "agent host" (Copilot, Claude,
   Codex providers). It stays local without sign-in (measured), but a distributable app must strip it.
4. A leftover macOS SDK newer than the Command Line Tools breaks native builds → automatic `SDKROOT`.
5. Undo right after an approval hit "session busy" → undo waits until the request has finished.

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

1. ~~Logo~~ – decided 2026-10-20: the Bobi logo (`branding/default/icon.svg`) stays; no FI logo needed. Company
   packs remain possible with `BOBI_BRANDING_DIR`.
2. ~~Packaged Bobi IDE.app~~ – decided 2026-10-19: run from source for now; packaging later (ADR-0008).
3. ~~Code tips and usage statistics~~ – built in phase 7.

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

- The COBOL parser covers the CardDemo dialect (fixed/free format, common statements); compiler-specific extensions,
  nested programs and `REPLACE` statements are not analysed. Dynamic `CALL` targets resolve only via `VALUE`.
- The mainframe server is tested only against the in-memory mock; a real system may answer differently (encodings,
  record formats, API versions). Submitted JCL can still do anything the job's user may – the allowlist checks DSNs,
  not programs; approval stays essential.
- Inbound A2A uses the single server password (no per-caller identity in the audit).
- Autocomplete sends the code around the cursor to the configured endpoint on every pause while typing (on-prem).

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
