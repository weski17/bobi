# Changelog

All notable changes to Bobi are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Bobi uses [Semantic Versioning](https://semver.org/). Versions 0.1.0–0.8.0 mark the end of the development
phases 1–8 (see [`docs/STATUS.md`](docs/STATUS.md) and the [demo guides](docs/demos/)).

## [Unreleased]

## [1.1.0] – 2026-11-19

Security release: fixes the critical and high findings of the security review of 2026-11-19.

**Upgrade notes (changed behaviour):**
- Every shell command asks, including `git status`/`diff`/`log`/`show`; `/commit`, `/pr` and the IDE commit button
  ask before they read the diff.
- Inbound A2A needs `BOBI_A2A_TOKEN` (at least 24 characters); callers send `Authorization: Bearer …` instead of the
  server password. Bobi does not start with A2A on and no token.
- Zowe profiles in a project folder are ignored; keep them in `~/.zowe`.
- `bobi compare --test` asks before running the test; scripts need `--trust-tests`.
- `submit_job` refuses JCL that calls procedures, uses `INCLUDE`/`JCLLIB`, the internal reader, `PATH=` or utilities
  with instream commands.

### Security

- No shell command runs without asking any more, read-only git included. `git log > file` wrote files without a
  question, `git show HEAD:x > .git/config` planted a hook that the next `git status` ran, and a crafted git
  directory in a repository ran code on `git status`. An explicit shell auto-approval never covers a redirect into a
  file (security review 2026-11-19, K1).
- Bobi IDE: a repository's `.vscode/settings.json` could choose the program the IDE starts (`bobi.command`). The
  setting is now read from the user's settings only and restricted in untrusted workspaces (K2).
- One "always allow" on an ordinary edit no longer opens `.bobi/`, `.bobiignore`, mainframe writes or A2A calls;
  protected resources always ask, compared without letter case (H1).
- Inbound A2A takes its own token (`BOBI_A2A_TOKEN`, required, valid only for `/a2a`) instead of the server password,
  which opened the whole engine API (H2). The A2A token and the Zowe password are masked like the server password.
- The Zowe connection ignores a project's `zowe.config.json`, which could send the mainframe password to any host
  (H3).
- `bobi compare --test` asks before it runs the test command on code a model wrote; `--trust-tests` skips the
  question (H4).
- `submit_job` refuses JCL whose datasets cannot be checked: procedures, `INCLUDE`, `JCLLIB`, internal reader,
  `PATH=`, utilities with instream commands (H5).
- The advisory security agent skips Dependabot pull requests; the required checks are bound to GitHub Actions; the
  limits of the gate and how to isolate the self-hosted runner are documented (H6, H7).

### Changed

- `/commit`, `/pr` and the IDE's commit message button ask before they read the diff.
- Inbound A2A needs `BOBI_A2A_TOKEN`; Bobi does not start with A2A on and no token.

## [1.0.1] – 2026-11-19

### Fixed

- Container images install the Debian security updates published after the pinned base image (`apt-get upgrade`);
  since 2026-11-07 the demo image failed its vulnerability scan because of `zlib1g` (CVE-2026-85091) and was not
  published.

### Security

- CVE-2026-97054 (Go standard library, HTTP/1 servers) in the engine's build tools esbuild and tsgo and in the
  bundled Ollama binary is accepted until 2026-12-19, limited to those files: the build tools run no server, Ollama
  listens on loopback inside the container only. Ollama needs an update built with Go 1.26.11 or later.

## [1.0.0] – 2026-11-19

First stable release: all requirements 1–20 are implemented, plus provable AI work (phase 8) and a security gate for
pull requests.

### Added

- Security gate on every pull request and push: Semgrep, gitleaks, `bun audit` and Trivy in one required check
  `security-gate`; a pull request fails only on findings it adds ([ADR-0027](docs/adr/0027-security-gate.md)).
- Advisory security agent: read-only built-in mode `security-ci` that posts one masked review comment per pull
  request; runs only on a self-hosted runner with a local model.
- Contributor guide, code of conduct, issue and pull request templates, code owners, changelog, release workflow,
  Dependabot for GitHub Actions.

### Fixed

- Usage audit records were written twice per model step (once without mode and model); each step is now recorded
  once, so `bobi usage` and the dossier token count are correct (#28).
- A model error ends the request cleanly instead of leaving it waiting; covered by a test (#31).

### Changed

- Version numbers set to 1.0.0 (`bobi --version`, IDE extension, local container image tag).

## [0.8.0] – 2026-11-06

Phase 8: provable AI work, plus product polish after phase 7.

### Added

- Signed, hash-chained change dossier per session and per task: prompt, model, tool calls, approvals, optional test
  result and diff; `bobi dossier [--task N|last] [verify]` (ADR-0022, ADR-0026).
- Model comparison on your own code: `bobi compare` runs the same task with 2–4 models in separate worktrees with the
  same test command.
- Signed private registry for skills and slash commands (`bobi registry`), with a signed revocation list; install
  refuses revoked packages even with `--force` (ADR-0023, ADR-0025).
- Web chat: the IDE chat panel as a web page in the demo image (ADR-0024).
- Code tips as a pull request check: `bobi tips --since <ref>` and CI job `tips`.
- Image scan with Trivy that fails on new HIGH/CRITICAL findings; known findings in a dated baseline.
- Docker Compose setup with egress allowlist; multi-platform images (amd64, arm64) on GitHub Packages.
- Demo image with a bundled local model, web terminal and sample project; tested end to end before publishing.
- German user handbook, deployment guide, tester guide, product README, feature tour video.

## [0.7.0] – 2026-10-20

Phase 7: quality, usage and robustness.

### Added

- Code tips for TypeScript/JavaScript and COBOL (complexity, length, nesting, anti-patterns) as IDE diagnostics with a
  "Simplify" quick fix, and as `bobi tips` with a CI gate.
- Usage statistics per person, team, mode and day: tasks, tokens, tool calls, approved and rejected changes
  (`bobi usage`).
- Red team with promptfoo: 8 attacks by a compromised mock model, all contained.
- Load test: parallel sessions with p50–p99 and Bobi's own overhead.

## [0.6.0] – 2026-10-20

Phase 6: mainframe and enterprise features.

### Added

- COBOL MCP server with its own parser: outline, call graphs, field data flow, impact analysis; tested on AWS CardDemo.
- Mainframe MCP server over Zowe-compatible REST services, with a dataset allowlist; writes and jobs always ask.
- Autocomplete (single and multi line) in Bobi IDE, off until a model is configured.
- Local audit log and audit reports (`bobi audit`), architecture diagrams (`bobi diagram`).
- A2A: agent card at `/.well-known/agent-card.json`, read-only inbound tasks, outbound `a2a` tool with approval.

## [0.5.0] – 2026-10-19

Phase 5: Bobi Shell, agents and workflows.

### Added

- Orchestrator mode that delegates subtasks to other modes; subtask approvals reach the user.
- Security mode and `/security-review`.
- Skills (`SKILL.md`) and project slash commands (`.bobi/commands/*.md`).
- Git: `/commit`, `/pr`, commit message button in the IDE.
- Literate coding in the IDE: write an instruction at the code, trigger it, review the diff.
- `bobi modes`, `bobi run --mode <slug>`.

## [0.4.0] – 2026-10-19

Phase 4: Bobi IDE.

### Added

- Bobi IDE built from Code-OSS with its own branding; built-in third-party chat features off, no outbound connections
  when idle (measured).
- Chat panel with streaming, modes, stop and undo; context from open tabs and the selection.
- Diff before apply: proposals open in the diff editor and are written only after *Accept*.
- Project trust dialog (`bobi trust`); integration test inside the real IDE.

## [0.3.0] – 2026-10-19

Phase 3: MCP.

### Added

- MCP client for local and remote servers, enabled per mode; MCP calls ask, results are marked as untrusted data.
- Code graph MCP server (TypeScript/JavaScript): symbols, callers and callees, call paths, file dependencies; built in
  for every project.

## [0.2.0] – 2026-10-19

Phase 2: modes and project context.

### Added

- Built-in modes `code`, `plan`, `ask`, `advanced`, `orchestrator`; custom modes in `.bobi/custom_modes.yaml`
  (same slug overrides a built-in mode).
- Rules in `.bobi/rules/` and `.bobi/rules-{mode}/`, `AGENTS.md`, `/init`, `.bobiignore`.
- Project trust, terminal WebSockets, sandbox hardening.

### Fixed

- The model per mode was configurable but had no effect.

## [0.1.0] – 2026-10-19

Phase 1: the core.

### Added

- Bobi as its own application on the OpenCode engine: own server, data directory `~/.bobi`, `bobi`, `bobi run`,
  `bobi serve`, `bobi attach`.
- Configurable model endpoint (OpenAI-compatible, optional Anthropic-compatible), keys only from the environment;
  only the model endpoint is contacted (tested).
- Approvals for every write, command and network access by default; checkpoints with undo, also without git.
- Secret masking, untrusted-data marking, audit via OpenTelemetry.
- Browser tool (headless, approval per page), mock model endpoint for tests.
- Sandbox: unprivileged Podman container, internal network, egress allowlist proxy.
- CI with typecheck, tests, coverage gate and terminal-UI end-to-end tests.

[Unreleased]: https://github.com/weski17/bobi/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/weski17/bobi/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/weski17/bobi/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/weski17/bobi/compare/v0.8.0...v1.0.0
[0.8.0]: https://github.com/weski17/bobi/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/weski17/bobi/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/weski17/bobi/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/weski17/bobi/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/weski17/bobi/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/weski17/bobi/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/weski17/bobi/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/weski17/bobi/releases/tag/v0.1.0
