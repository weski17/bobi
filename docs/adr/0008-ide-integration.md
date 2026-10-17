# ADR-0008: Bobi IDE integration with Code-OSS

- Status: Proposed
- Date: 2026-10-17

## Context

Code-OSS has a full native chat stack (`src/vs/workbench/contrib/chat`), chat editing sessions with per-file keep/undo and
multi-diff, and stable APIs for chat participants and language model providers. It is coupled to GitHub Copilot via
`product.json#defaultChatAgent`. Built-in extensions may use proposed APIs without product.json changes.

## Decision

- Bobi chat is a **built-in extension** `extensions/bobi-chat` (sources in `packages/ide-extension`), talking to the Bobi
  server via `@opencode/client` + SSE. No agent logic in the extension.
- Reuse the native Chat view: register a default chat participant; show edits through the chat editing session
  (`stream.textEdit`, proposed API `chatParticipantAdditions`) so the user reviews inline diffs before accepting.
  Fallback if the proposed API breaks: stable `WorkspaceEdit` with `needsConfirmation` (Refactor Preview).
- Neutralise Copilot: remove `defaultChatAgent`, `trustedExtensionAuthAccess`, `builtInExtensionsEnabledWithAutoUpdates`,
  `voiceWsUrl`; self-host webview assets; extension gallery = internal Open VSX mirror or none.
- Full rebrand: names, bundle ids, GUIDs, icons. No Microsoft or IBM names or logos.

## Consequences

- Least-invasive path: product.json overlay + ~2 build-list patches + Copilot-neutralising patches.
- Dependence on proposed APIs is the biggest IDE risk; pin to Code-OSS release tags and test on each bump.
