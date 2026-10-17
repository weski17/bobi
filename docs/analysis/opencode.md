# OpenCode analysis (Phase 0)

- Upstream: `anomalyco/opencode` (formerly `sst/opencode`, MIT), commit `180fd9d`, v2.0.31 (2026-10-16), shallow clone
- Not to be confused with the archived Go project `opencode-ai/opencode`.
- Method: read-only analysis. Items marked UNVERIFIED were not confirmed in the code.

**Important:** this is the **V2 rewrite on Effect v4**. Most docs in `packages/web/src/content/docs/` still
describe V1 config syntax; V1 config is migrated (`core/src/v1/config/migrate.ts`). Native V2 schema:
`packages/schema/src/config.ts`.

## 1. Layout and tooling

| Keep (core) | Optional (UI) | Ignore (SaaS/infra) |
|---|---|---|
| `schema`, `core` (~70k LOC), `ai` (~33k), `protocol`, `server`, `client`, `sdk`, `plugin`, `util`, `cli`, `codemode`, `http-recorder`, `simulation` | `tui`, `app`, `desktop`, `session-ui`, `ui`, `theme` | `console/*`, `stats/*`, `function`, `web`, `posts`, `containers`, `identity`, `infra/`, `services/`, `sst.config.ts` |

- Runtime **Bun 1.4.2** (`packageManager`), Turbo 2.10, `tsgo`, oxlint. Tests: **bun test**, per package
  (`cd packages/core && bun run test`); `script/test.ts` sandboxes HOME/XDG and strips API keys.
- Core engine ≈ 140k LOC TypeScript; core has 262 test files.

## 2. Agent loop, storage, streaming

- Loop: `core/src/session/runner/llm.ts` (`SessionRunner.drain`, `runStep`), one step via `runner/step.ts`, step limit per agent (`runner/max-steps.ts`), retries `runner/retry.ts`.
- Storage: event-sourced SQLite via Drizzle (`core/src/event/sql.ts`, projections in `session/projector.ts`). DB path overridable with `OPENCODE_DB`.
- Streaming: `LLMEvent`s → Bus → SSE `GET /api/event`.

## 3. Model providers

- `providers.<id>` with `settings.baseURL`, `headers`, `models` (`schema/src/config/provider.ts`); `${ENV}` expansion in `baseURL`.
- OpenAI-compatible with custom baseURL: **yes**. Anthropic-compatible: native provider exists (`ai/src/providers/anthropic-compatible.ts`), config selection UNVERIFIED.
- Built-in provider plugins for ollama, vllm, lmstudio, local (`core/src/plugin/provider/`).
- Per-agent model: **yes**, `agents.<id>.model`.
- Config discovery (`core/src/config/discovery.ts`): system dir, MDM, global dir, `opencode.json[c]` + `.opencode/` walking up, env `OPENCODE_CONFIG`, `OPENCODE_CONFIG_DIR`, `OPENCODE_CONFIG_CONTENT`.

## 4. Agents (= Bobi modes)

- Schema `schema/src/agent.ts`: `model`, `system`, `mode` (primary|subagent|all), `hidden`, `steps`, `permissions`.
- **Default permissions allow everything** (`{action:"*", resource:"*", effect:"allow"}`), only `*.env` reads ask. Verified in `schema/src/agent.ts:39`.
- Built-ins: `build`, `plan` (`core/src/plugin/plan.ts`, denies edits), subagents `general`, `explore`; hidden `compaction`, `title`, `summary`.
- Custom agents: JSON `agents: {...}` or Markdown `.opencode/{agents,modes}/*.md`; override by id, merged field-by-field; `disabled: true` removes.

## 5. Tools and plugin system

- Built-ins (`core/src/tool/plugin/`): `read`, `write`, `edit`, `patch`, `glob`, `grep`, `shell`, `webfetch`, `websearch`, `question`, `skill`, `subagent`, MCP resource tools. **No browser-automation tool.**
- Plugin API (`packages/plugin`): `Plugin.define({id, setup})` with transforms for agent, command, mcp, model, provider, skill, tool, …
  and hooks `tool.execute.before/after`, `session.context`, `session.model.request`, `permission.evaluate`, `shell.create.before`.
- Loading: config `plugins: [...]` or `.opencode/plugins/*.ts`; `"-<id>"` disables a plugin (not the guarded ones).
- **Best extension point:** a separate Bobi plugin package + embedding via `@opencode/sdk` or `opencode serve` → no upstream edits.

## 6. Permissions

- Rules `{action, resource, effect: allow|ask|deny}`, **last match wins**, no match → `ask` (`core/src/permission.ts`).
- Shell commands are parsed; each sub-command is a resource (e.g. `git push*`). `edit`/`write`/`patch` share action `edit`.
- Replies `once | always | reject`; `--auto` approves all `ask`. Managed policies: `core/src/managed-policy.ts`.

## 7. Checkpoints

- Shadow git repo per project (`core/src/snapshot.ts`), **only for git projects**; revert API `POST /api/session/:id/revert/stage|commit`, `DELETE …/revert`.

## 8. Project context

- AGENTS.md from global dir + walking up the tree (`core/src/config/plugin/instruction.ts`); `instructions: [globs|URLs]`.
- `/init` command: `core/src/plugin/command.ts` + `plugin/command/initialize.txt`.
- No dedicated ignore file found (`.opencodeignore` UNVERIFIED) → `.bobiignore` must be built by Bobi.

## 9. MCP client

- `mcp.servers.<name>` local (`command[]`) or remote (`url`, OAuth). Tool names `<server>_<tool>`; per-agent enablement only via permission rules.

## 10. Server and clients

- `opencode serve` on `127.0.0.1:49374`, Basic auth via `OPENCODE_SERVER_PASSWORD`, OpenAPI `packages/protocol/openapi.json` (~140 ops), V2 API still being audited (`V2_HTTP_API_AUDIT.md`).
- Clients: `@opencode/client` (generated, browser-safe), `@opencode/sdk` (in-process), ACP server (`cli/src/acp`).
- `sdks/vscode` is trivial (opens a terminal) → not reusable.

## 11. Telemetry and outbound calls

- OTel built in, opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT` (`util/src/observability.ts`). No analytics in core/cli/server.
- Outbound calls to disable on-prem:
  - `models.opencode.ai` catalog → `OPENCODE_DISABLE_MODELS_FETCH=1` (verified `cli/src/server-process.ts:115`)
  - updater → `OPENCODE_DISABLE_AUTOUPDATE=1` (verified `cli/src/services/updater.ts:534`)
  - Console/Zen provider (`core/src/plugin/provider/opencode.ts`, guarded, cannot be disabled by config)
  - Exa web search (`core/src/plugin/websearch/exa.ts`), `.well-known/opencode` remote config, remote skill index,
    CIMD OAuth URL, runtime npm installs (`util/npm`, `plugin/provider/dynamic.ts`), remote `instructions` URLs
  - Copilot/ChatGPT OAuth providers

## 12. Skills and commands

- `SKILL.md` under `skills/` in config dirs; commands as `commands/**/*.md` or config `commands`.

## 13. Churn

- Near-daily releases (v2.0.26 → v2.0.31 within a week), V2 API not yet stable.
- → Depend only on plugin, SDK and HTTP surfaces; pin to release tags.
