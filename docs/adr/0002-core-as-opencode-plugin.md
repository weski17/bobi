# ADR-0002: Bobi core as an OpenCode plugin

- Status: Accepted (2026-10-19)
- Date: 2026-10-17

## Context

OpenCode V2 (Effect v4) offers a plugin API (`packages/plugin`) with transforms for agents, tools, MCP, providers,
skills and commands, and runtime hooks such as `tool.execute.before/after`, `session.context`,
`session.model.request` and `permission.evaluate`. Internals change frequently; the V2 HTTP API is still being audited.

## Decision

All Bobi-specific engine behaviour lives in **`@bobi/core`**, an OpenCode plugin loaded via the `plugins` config:
modes, `.bobi/` loader, `.bobiignore` enforcement, secure permission defaults, untrusted-data labelling of tool output,
secret masking, audit attributes, browser tool.
Bobi depends only on the public surfaces: `@opencode/plugin`, `@opencode/sdk`, `@opencode/client` and the HTTP API.
Patching OpenCode core is a last resort and needs its own ADR entry in the patch header.

## Alternatives considered

- Patch Bobi features directly into `packages/core`: fastest now, but breaks on almost every upstream release.
- Write our own engine: contradicts CLAUDE.md (technical base) and loses a mature loop, permissions and snapshots.

## Consequences

- Upstream updates mostly need no Bobi changes; plugin API breaks are caught by integration tests.
- Known gap: guarded internal plugins (e.g. the vendor Console provider) cannot be removed via config → small patch (see ADR-0003).
