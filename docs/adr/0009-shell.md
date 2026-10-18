# ADR-0009: Bobi Shell

- Status: Accepted (2026-10-19)
- Date: 2026-10-17

## Context

Bobi Shell must offer interactive and headless use on the same core. OpenCode ships a CLI (`serve`, `run`, `acp`) and a TUI.

## Decision

- `@bobi/shell` provides the `bobi` binary: it builds the OpenCode config via `@bobi/config`, sets the offline env flags,
  loads `@bobi/core` and then delegates to the OpenCode CLI/TUI (interactive) or `run` (headless, JSON output).
- Branding of visible CLI/TUI strings via a small patch set; no fork of the TUI code.
- Bobi Shell and Bobi IDE can share one running server per project.

## Consequences

- Identical behaviour across surfaces by construction; TUI look stays close to upstream.
