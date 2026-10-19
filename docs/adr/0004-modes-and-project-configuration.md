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

## Phase 2 implementation (2026-10-19) – supersedes details above

- **Format** (`packages/modes`): `customModes:` list with `slug`, `name`, `description?`, `roleDefinition`, `whenToUse?`,
  `customInstructions?`, `groups`. Groups: `read`, `edit` (or `[edit, { fileRegex, description? }]`), `execute`,
  `browser`, `mcp`, `subtask`. Unknown keys and groups are errors. The `tools`/`model`/`mcp` keys proposed above are not
  used: models per mode stay in `.bobi/config.jsonc` (`modes.<slug>.model`), MCP per mode follows in Phase 3.
- **Built-in modes** (`packages/modes/builtin-modes.yaml`): `code` (default), `plan` (Markdown edits only), `ask`
  (read only), `advanced` (+MCP), `orchestrator` (read + delegate). The engine's `build` and `plan` agents are removed.
- **Load order:** built-in → `$BOBI_HOME/custom_modes.yaml` → `<project>/.bobi/custom_modes.yaml`; same slug replaces the
  mode entirely. Files are watched and reloaded.
- **Enforcement:** modes are engine agents. Rules per agent: engine default → Bobi policy → auto-approvals → protected
  rules (`.bobi/**`, `.bobiignore` always ask) → **deny rules for missing groups** (last, so they win). Tools of missing
  groups are also removed from the model's tool list; `fileRegex` is checked before every edit/write/patch.
- **Per-mode model:** the engine uses the session model for turns, so Bobi switches it in the `prompt` hook when a
  session enters another mode (a model the user picks within a mode is kept).
- **Rules and AGENTS.md** are loaded by Bobi (the engine's project discovery is off, ADR-0013): `$BOBI_HOME/rules-{mode}/`
  → `$BOBI_HOME/rules/` → `.bobi/rules-{mode}/` → `AGENTS.md` (project root down to the location) → `.bobi/rules/`;
  recursive, alphabetical, empty and cache files skipped, symlink loops ignored.
- **Identity:** the engine's base prompt is rebranded to Bobi in the `context` hook (no upstream patch).
- **`/init`:** Bobi's own prompt; **`.bobiignore`** as above, plus filtering of grep/glob results.
