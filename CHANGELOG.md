# Changelog

All notable changes to Bobi are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Bobi uses [Semantic Versioning](https://semver.org/). Versions 0.1.0–0.8.0 mark the end of the development
phases 1–8 (see [`docs/STATUS.md`](docs/STATUS.md) and the [demo guides](docs/demos/)).

## [Unreleased]

## [1.0.1] – 2026-11-19

### Fixed

- Container images install the Debian security updates published after the pinned base image (`apt-get upgrade`);
  since 2026-11-07 the demo image failed its vulnerability scan because of `zlib1g` (CVE-2026-85091) and was not
  published.

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

[Unreleased]: https://github.com/weski17/bobi/compare/v1.0.1...HEAD
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
