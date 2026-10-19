# Status

**Current phase: 1 – core** · Branch `phase-1-core` · waiting for approval

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
| Checkpoints in projects **without git** | ⏳ decision needed | open questions |
| Sandbox: Podman container, unprivileged, internal network, egress allowlist proxy | ✅ | `sandbox/`, `packages/egress-proxy`, `tests/sandbox` |
| CI: typecheck, tests, coverage gate, Semgrep | ✅ green on GitHub | `.github/workflows/ci.yml` |
| Repository on GitHub (private) | ✅ | https://github.com/weski17/bobi |
| Demo guide | ✅ | docs/demos/phase-1.md |

Tests: **136 pass, 1 todo, 0 fail** (+ 3 sandbox tests) · line coverage 99.7 % · typecheck clean · CI green.

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
5. **Container runtime:** Podman (neither Docker nor Podman is installed yet).
6. **CI:** GitHub Actions.
7. **Browser tool:** headless Playwright (Apache-2.0).

## Open questions

1. **Checkpoints without git** – two options:
   - a) Bobi writes a `.git` pointer file into the project that points to a hidden repo in `~/.bobi` (uses OpenCode's
     snapshots unchanged; side effect: `git` commands in that folder then see this repo).
   - b) Bobi backs up every file before the agent changes it in its own store (no trace in the project; covers file
     tools, but not changes made by shell commands).
2. ~~License~~ – decided 2026-10-19: MIT, © Finanz Informatik GmbH & Co. KG (`LICENSE`).
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
- WebSocket endpoints (persistent terminals in the TUI) are not proxied by the Bobi HTTP front yet.
- The sandbox image is 4.5 GB (engine dev dependencies + Chromium); slimming it is future work.
