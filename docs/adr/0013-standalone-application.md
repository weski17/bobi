# ADR-0013: Bobi as a standalone application

- Status: Accepted (2026-10-19, requested by the project owner)
- Date: 2026-10-19
- Supersedes: the "plugin loaded through config" part of ADR-0002 and the launcher part of ADR-0009

## Context

Phase 1 ran Bobi as "OpenCode CLI + `@bobi/core` loaded through the `plugins` config entry". This had two problems:

1. OpenCode only logs a warning when a configured plugin cannot be loaded and then runs with allow-all defaults.
   A launcher-side check mitigated it, but every other entry point would have to repeat the check.
2. The product was visibly OpenCode (name, logo, data in `~/.local/share/opencode`, `opencode` commands).

The project owner asked for Bobi to be its own application rather than a plugin.

## Decision

- **One `bobi` binary/entrypoint** (`packages/shell`) with its own commands: `bobi` (TUI), `bobi run` (headless),
  `bobi serve` (server for the IDE and the container). Everything else is refused.
- **Bobi owns the server process** (`packages/server`): it embeds the OpenCode engine in-process via the SDK's
  embedded host and registers `@bobi/core` as a **host plugin**. A failing host plugin fails host creation – there is
  no path that runs without Bobi's safeguards. Bobi adds its own password-protected HTTP front.
- **Own data directories:** `~/.bobi` (or `$BOBI_HOME`) for database, snapshots, config and logs, set through the
  engine's `Global` service rather than environment variables, so agent shell commands are unaffected.
- **OpenCode stays the engine** (CLAUDE.md technical base). The TUI is OpenCode's, connected to the Bobi server with
  `--server`; branding is changed by a small patch series in `patches/opencode/` (ADR-0001).
- `@bobi/core` remains an OpenCode plugin internally – that is the engine's extension API – but it is never optional.

## Consequences

- Removes the config-loaded plugin entry and the launcher's `verifyCore` check.
- Bobi depends on one internal OpenCode module (`packages/sdk/src/internal/host.ts`), because the public Promise SDK does
  not expose the request handler. Guarded by integration tests; candidate for an upstream PR.
- WebSocket endpoints (persistent terminals in the TUI) are not proxied by the Bobi HTTP front yet.
