# ADR-0024: Web chat (the IDE chat panel as a web page)

- Status: Accepted (2026-11-03)
- Date: 2026-11-03

## Context

The web IDE (ADR-0021) cannot show Bobi's chat panel without a wildcard host name and certificate, because VS Code
webviews need their own origin. Testers still need a graphical chat with approvals and diffs that works with nothing but
a browser, also on a server behind a normal reverse proxy.

## Decision

- New package `packages/web-chat`. The browser bundle (`bun build`, 15 KB, no dependency) runs the **same
  `ChatController`** as the IDE and the **same panel page** (`ide-extension/media/chat.js` and `chat.css`); it only replaces
  what VS Code provides: `acquireVsCodeApi()` and the diff editor (the patch is shown inside the approval card, text only).
- `BobiClient` sends no credentials when it has no password (the page's own login applies) and no longer calls `fetch`
  with itself as `this` (browsers reject that).
- A small **gate** (`src/gate.ts`, Bun) serves the page on port 7682 of the demo image: HTTP Basic login (user `demo`,
  the demo password), `Origin` must match `Host`, strict content security policy, and a **list of the exact API calls**
  the chat uses (sessions, prompt, interrupt, agent switch, permissions, messages, revert, events, agent list). Everything
  else of the engine's API returns 404. The gate adds the Bobi server's own credentials; visitors never see them.
- The demo image always starts the gate. The experimental web IDE moves to port 7683.
- Mode, streaming answer, tool activity, approval with diff, stop, new chat and undo all work as in the IDE.

## Consequences

- One chat implementation for IDE and browser; fixes apply to both.
- The chat page is one shared workspace for all visitors (like the IDE demo): a copy of the sample project in a volume.
- The page has no Markdown rendering and no file attachments (the IDE panel does not either).
- The gate is a reverse proxy for a narrow API, not a general one; new chat features that need more endpoints must extend
  the list in `gate.ts` and its test.
- TLS: with certificate files in `/run/tls` the gate serves HTTPS itself; behind Caddy plain HTTP on the loopback is fine.
