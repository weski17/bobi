# Code-OSS analysis (Phase 0)

- Upstream: `microsoft/vscode` (MIT), commit `5e1d1ea5` (2026-10-16), shallow partial clone
- Method: read-only analysis of the public repository. Items marked UNVERIFIED were not confirmed in the repo.

## 1. Build

- Node **24.18.0** (`.nvmrc`); `build/npm/preinstall.ts` enforces Node 24 and npm < 13. npm with `package-lock.json`.
- Electron **43.7.7** (`.npmrc`, `build_from_source=true`) → native modules via node-gyp. macOS needs Xcode CLT + Python (UNVERIFIED, upstream wiki).
- Scripts: `npm run compile`, `npm run watch`, `npm run gulp <task>`; run from source with `scripts/code.sh`.
- Desktop build: `npm run gulp vscode-darwin-arm64-min` (targets in `build/gulpfile.vscode.ts:564`).

## 2. Branding (`product.json`)

Must change: `nameShort`, `nameLong`, `applicationName`, `dataFolderName`, `sharedDataFolderName`,
server/tunnel names, all `win32*` fields (new GUIDs), `darwinBundleIdentifier`, `darwinProfile*UUID`,
`linuxDesktopName`, `linuxIconName`, `urlProtocol`, `reportIssueUrl`, `licenseUrl`,
`webviewContentExternalBaseUrlTemplate` (points to `vscode-cdn.net` → self-host).

Absent in OSS (good): `extensionsGallery`, `updateUrl`, `enableTelemetry`, `aiConfig`, `tasConfig`, `crashReporter`.
Extension gallery: Open VSX or an internal mirror (Microsoft Marketplace terms forbid forks – UNVERIFIED).

Replace icons in `resources/{darwin,linux,win32,server}`. "Visual Studio Code"/"VS Code" names and logo are
Microsoft trademarks and must not appear in Bobi IDE.

## 3. Built-in extensions (least invasive extension point)

- `build/lib/extensions.ts:413` packages every `extensions/*/package.json` → a folder `extensions/bobi-*/` ships automatically.
- Two upstream list edits needed: `build/gulpfile.extensions.ts:54` (compilations) and `build/npm/dirs.ts` (npm install).
- Alternative with zero tree changes: ship a VSIX via `product.json#builtInExtensions` (sha256-pinned).

## 4. Chat infrastructure

- Core: `src/vs/workbench/contrib/chat/` (participants, `chatEditing/`, `languageModels.ts`), `contrib/inlineChat/`.
- Stable API (`src/vscode-dts/vscode.d.ts`): `chat.createChatParticipant`, `lm.registerLanguageModelChatProvider`,
  `lm.registerTool`, `lm.registerMcpServerDefinitionProvider`.
- Proposed API needed for edits flowing into the native chat-editing (diff/keep/undo) UI:
  `chatParticipantAdditions` (`stream.textEdit`), `defaultChatParticipant` (`isDefault`).
- Built-in extensions may use proposed APIs via their own `enabledApiProposals`
  (`services/extensions/common/extensionsProposedApi.ts:110`).
- Reference implementation in-tree: `extensions/copilot` (MIT, excluded from builds).

## 5. Copilot coupling to neutralize

- `product.json#defaultChatAgent` (GitHub endpoints, entitlement URLs) → removing it is the main kill switch
  (`services/chat/common/chatEntitlementService.ts:458`).
- Also: `trustedExtensionAuthAccess`, `builtInExtensionsEnabledWithAutoUpdates`, `voiceWsUrl`.
- ~40 files reference `defaultChatAgent`, 13 hard-code `GitHub.copilot-chat` → test UI after removal.
- Do **not** use `chat.disableAIFeatures` – it would hide Bobi's UI too.

## 6. Telemetry / network

- OSS build has no telemetry sink (`platform/telemetry/common/telemetryUtils.ts:96`), no update service, no gallery, no experiments.
- Remaining outbound defaults: webview CDN, Copilot endpoints, `voiceWsUrl`, build-time download of `ms-vscode.*` VSIXs from GitHub.

## 7. Inline diffs before applying

- Preferred: chat editing session (`contrib/chat/common/editing/chatEditingService.ts`) – per-file keep/undo,
  multi-diff, checkpoints; reached via `stream.textEdit` (proposed API).
- Stable fallback: `WorkspaceEditEntryMetadata.needsConfirmation` → Refactor Preview (`contrib/bulkEdit/browser/preview/`).

## 8. Size, churn, fork strategy

- ~940 MB checkout, ~20.8k files; very high churn, chat/agent area moves fastest (UNVERIFIED rate).
- Recommendation: small ordered patch series + `product.json` overlay (VSCodium-style), Bobi code only in
  new `extensions/bobi-*` folders, rebase onto release tags, prefer stable APIs.
