# ADR-0008: Bobi IDE integration with Code-OSS

- Status: Accepted (2026-10-19)
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

## Phase 4 implementation (2026-10-19) – deviations from the decision above

- **Own webview chat panel instead of the native Chat view.** The native view is coupled to Copilot entitlement and
  setup flows and to proposed APIs (`chatParticipantAdditions`) that change without notice. The webview uses stable APIs
  only. The built-in AI features are switched off by default (`chat.disableAIFeatures`, contributed by the extension).
- **Diff before apply via approvals:** the engine sends a unified diff with every edit approval
  (`metadata.files[].patch`); the extension applies it to the current file and opens the diff editor; the file is
  written only after "Accept". One-click undo uses the engine's revert API.
- **Server per workspace:** the extension runs `bobi serve` (project trust asked as a modal dialog via `bobi trust`).
- **Branding:** `scripts/ide/brand.ts` (product.json overlay, icon from the branding pack); removed keys:
  `defaultChatAgent`, `trustedExtensionAuthAccess`, `voiceWsUrl`, `webviewContentExternalBaseUrlTemplate`, gallery and
  update URLs. `builtInExtensionsEnabledWithAutoUpdates` must stay (empty list).
- **Patches** (`patches/code-oss/`): 0001 skips the Copilot onboarding wizard, 0002 makes the default account service
  work without `defaultChatAgent` – both crashed the workbench otherwise.
- **Measured:** an idle Bobi IDE opens no outbound connections (40 s `lsof` sampling, only loopback listeners).
- **Packaged app: not yet.** Code-OSS 1.141 depends on proprietary GitHub packages (`@github/copilot`,
  `@github/copilot-sdk`, licence "SEE LICENSE IN LICENSE.md") and its packaging pipeline builds the Copilot extension.
  A distributable Bobi IDE needs these stripped from the build (VSCodium maintains MIT-licensed patches for exactly
  this). Until then Bobi IDE runs from source (`bobi-ide`); the proprietary packages stay in the local `node_modules`
  only and are never redistributed.
