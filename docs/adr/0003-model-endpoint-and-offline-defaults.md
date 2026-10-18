# ADR-0003: Model endpoint and offline-by-default configuration

- Status: Accepted (2026-10-19)
- Date: 2026-10-17

## Context

Bobi must work with any OpenAI-compatible (optionally Anthropic-compatible) gateway, with a model per mode,
and no data may leave the company network. OpenCode supports custom `baseURL` providers and per-agent models,
but contacts several vendor services by default (model catalog, updater, Console/Zen provider, Exa web search,
remote skill index, `.well-known` remote config, CIMD OAuth URL, runtime npm installs).

## Decision

- Bobi config `bobi.jsonc` (+ env) is translated by `@bobi/config` into OpenCode config and passed via
  `OPENCODE_CONFIG_CONTENT` / `OPENCODE_CONFIG_DIR`. Users never edit OpenCode config directly.
- One provider `bobi` of type OpenAI-compatible; default `baseURL` = `http://localhost:4000/v1` (local gateway),
  API key only from env `BOBI_MODEL_API_KEY`. Optional second provider for Anthropic-compatible endpoints.
- `modes.<slug>.model` maps to `agents.<id>.model`.
- The Bobi launcher always sets `OPENCODE_DISABLE_MODELS_FETCH=1`, `OPENCODE_DISABLE_AUTOUPDATE=1`, disables Exa web search,
  remote skills, remote instructions and runtime npm installs, and disables the Copilot/ChatGPT/OpenCode providers.
- Whatever cannot be switched off by config gets a minimal patch; an integration test asserts **zero outbound connections**
  except the configured endpoint during a session.

## Consequences

- Works with LiteLLM, vLLM, Ollama without code changes.
- Model metadata (context size, pricing) must come from config or a bundled catalog copy.

## Phase 1 notes (2026-10-19)

- Implemented in `packages/config` (`toOpenCodeConfig`, `DISABLED_PLUGINS`, `OFFLINE_ENV`, `SDK_OFFLINE_OPTIONS`).
- The API key is passed by name (`providers.bobi.env`), never as a value; verified against the mock endpoint.
- Embedded SDK hosts must pass `SDK_OFFLINE_OPTIONS` – the SDK ignores `OPENCODE_DISABLE_MODELS_FETCH`.
- ripgrep must be preinstalled, otherwise OpenCode downloads it from GitHub.
- `opencode.provider.opencode` stays loaded (guarded upstream); no outbound call observed without a vendor login.
