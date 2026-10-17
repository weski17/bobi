# ADR-0005: Secure-by-default permissions

- Status: Proposed
- Date: 2026-10-17

## Context

CLAUDE.md requires confirmation for every write and every shell command unless auto-approve is configured explicitly.
**OpenCode's default agent permissions allow everything** (`{action:"*", resource:"*", effect:"allow"}`,
`packages/schema/src/agent.ts`); only `.env` reads ask. Rules evaluate last-match-wins; no match → ask.

## Decision

- `@bobi/core` replaces the default ruleset of every Bobi mode with: `read/grep/glob` allow (minus `.bobiignore`),
  `edit`, `shell`, `webfetch`, `browser`, MCP tools, `external_directory` → **ask**; secrets paths → deny.
- Auto-approve only via explicit config (`autoApprove` per mode and pattern) in `.bobi/config.jsonc` – versioned, reviewable.
  The OpenCode `--auto` flag is not exposed by the Bobi Shell.
- "Always allow" answers are stored per project and listed in the UI so they can be revoked.
- A test suite asserts the effective ruleset for each mode (golden files).

## Consequences

- More prompts by default – intended. Security over speed.
