# Status

**Current phase: 1 – core** · Branch `phase-1-core` · waiting for approval

## Phase 1

| Task | Status | Where |
|---|---|---|
| Tools installed (Bun 1.4.3, Node 24.22, Podman 6.1, ripgrep, bash 5) | ✅ | docs/DEVELOPMENT.md |
| OpenCode v2.0.32 as pinned submodule, upstream baseline green (6632 pass) | ✅ | `vendor/opencode` |
| Bun workspace linking upstream packages (never from npm) | ✅ | `scripts/link-upstream.ts` |
| Mock model endpoint (OpenAI-compatible, streaming, tool calls) | ✅ | `packages/mock-model` |
| Config: `bobi.jsonc` + env → OpenCode config, keys only from env | ✅ | `packages/config` |
| Offline: vendor plugins, catalog fetch, updater, web search off; test: only the model endpoint is contacted | ✅ | `tests/integration/offline.test.ts` |
| Secure permissions: every write/shell/network action asks; auto-approve only explicit | ✅ | `packages/core/defaults/permissions.jsonc` |
| Secret masking (tool output, audit) | ✅ | `packages/core/src/masking.ts` |
| Prompt-injection marking of tool output + system rule | ✅ | `packages/core/src/untrusted.ts` |
| Audit: OTLP spans with user, mode, tool, result | ✅ | `packages/core/src/audit.ts` |
| Browser tool (headless Playwright, approval per page) | ✅ | `packages/browser` |
| Checkpoints + undo in git projects | ✅ | `tests/integration/checkpoints.test.ts` |
| Checkpoints in projects **without git** | ⏳ decision needed | see open questions |
| `bobi` launcher (TUI + headless), fail-closed if bobi.core not active | ✅ | `packages/shell` |
| CI workflow (typecheck, tests, coverage gate, Semgrep) | ⚠️ written, not yet run (no remote) | `.github/workflows/ci.yml` |
| Sandbox container + egress allowlist | ⏳ not started (needs `podman machine init`) | ADR-0007 |
| Demo guide | ✅ | docs/demos/phase-1.md |

Tests: **105 pass, 1 todo, 0 fail** · line coverage 96.7 % (core/config 100 %) · typecheck clean.

## Phase 1 findings

1. **OpenCode runs without a plugin if it cannot load it** (only a warning) → allow-all. `bobi` now verifies that
   `bobi.core` is active and refuses to start otherwise.
2. The embedded SDK ignores `OPENCODE_DISABLE_MODELS_FETCH` and calls `models.opencode.ai` → `SDK_OFFLINE_OPTIONS`.
3. Without a system ripgrep, OpenCode downloads it from GitHub at runtime → ripgrep is a prerequisite.
4. OpenCode's built-in browser plugin needs the OpenCode desktop app → disabled, replaced by `@bobi/browser`.
5. Snapshots are skipped when the session path and git worktree differ by a symlink (macOS `/var` → `/private/var`).
6. In headless `run` mode, approvals are auto-rejected (safe default).
7. The TUI still shows OpenCode branding (Phase 5).

## Phase 0 (done)

Analysis, architecture and ADRs 0001–0012 – see git history and docs/adr/.

## Decisions (2026-10-19)

All ADRs 0001–0011 accepted. Open questions answered:

1. **Runtime:** install Bun and Node 24 via Homebrew in Phase 1.
2. **Upstreams:** `vendor/opencode` as submodule in Phase 1; `vendor/code-oss` only in Phase 4.
3. **Default model endpoint:** **LiteLLM** at `http://localhost:4000/v1`.
4. **Non-git projects:** auto-create a private shadow repo for checkpoints.
5. **Container runtime:** Podman (neither Docker nor Podman is installed yet).
6. **CI:** GitHub Actions.
7. **Browser tool:** headless Playwright (Apache-2.0).

## Open questions

1. **Checkpoints without git** – two options:
   - a) Bobi writes a `.git` pointer file into the project that points to a hidden repo in `~/.bobi` (uses OpenCode's
     snapshots unchanged; side effect: `git` commands in that folder then see this repo).
   - b) Bobi backs up every file before the agent changes it in its own store (no trace in the project; covers file
     tools, but not changes made by shell commands).
2. **Sandbox:** may I run `podman machine init` (downloads a Linux VM image, ~1 GB) for the container work?
3. **Logo:** internal FI experiment, approved by the user on 2026-10-19; SVG approximation in `branding/fi/` (not committed).
   Replace with the official FI asset when available (ADR-0012).

## Risks

- Very high upstream churn (OpenCode near-daily, V2 API not yet stable).
- IDE depends on proposed Code-OSS chat APIs.
- `.bobiignore` cannot fully stop indirect reads via shell → sandbox is the real boundary.
- Secrets inside user files end up in checkpoint snapshots.
- If a configured plugin fails to load, OpenCode falls back to allow-all. The `bobi` launcher checks this; any other
  embedding (e.g. the IDE in Phase 4) must call `verifyCore` too.
- Secret masking is pattern-based: unknown secret formats can slip through (known secret values are always masked).
- Headless Chromium runs on the host until the sandbox exists.
