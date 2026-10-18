# ADR-0004: Modes and project configuration format

- Status: Accepted (2026-10-19)
- Date: 2026-10-17

## Context

Bobi needs modes `plan`, `code`, `ask`, `advanced`, `orchestrator` with own prompts and tool rights, project modes in
`.bobi/custom_modes.yaml` (override by slug), rules in `.bobi/rules/` and `.bobi/rules-{mode}/`, and `.bobiignore`.
Publicly documented comparable products use a YAML list with `slug`, `name`, `roleDefinition`, `whenToUse` and tool groups.
OpenCode agents provide `system`, `model`, `mode`, `steps`, `permissions` and override-by-id.

## Decision

- **A Bobi mode is an OpenCode agent** (`mode: primary`). `@bobi/core` registers the five built-in modes from
  `defaults/modes.yaml` and hides/disables OpenCode's own `build` and `plan`.
- Own YAML schema (clean-room, written from scratch): `slug`, `name`, `description`, `prompt`, `model`,
  `tools` (groups: `read`, `edit`, `shell`, `browser`, `mcp`), `mcp` (allowed servers), `whenToUse`.
  Tool groups compile into OpenCode permission rules.
- Load order (later wins, same slug overrides): built-in → global `~/.bobi/custom_modes.yaml` → project `.bobi/custom_modes.yaml`.
- Rules: `.bobi/rules/*.md` (alphabetical) always injected; `.bobi/rules-{slug}/*.md` only for that mode, via `session.context`.
- `.bobiignore` (gitignore syntax) enforced in `tool.execute.before` for file tools and for paths in parsed shell commands.
  Known limit: shell commands can still read ignored files indirectly → the sandbox (ADR-0007) is the real boundary.

## Consequences

- A JSON Schema for `custom_modes.yaml` gives editor validation and PR-reviewable configs.
- Mode switches must keep conversation history; to be verified in Phase 2.
