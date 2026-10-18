# Development setup

## Prerequisites (macOS)

```bash
brew install oven-sh/bun/bun node@24 podman ripgrep bash
```

- `node@24` is keg-only: add `/opt/homebrew/opt/node@24/bin` to `PATH`.
- `ripgrep` must be on `PATH`. Otherwise OpenCode downloads it from GitHub at runtime (outbound call, not allowed on-prem).
- Some OpenCode shell tests need bash ≥ 5; macOS ships 3.2. `/opt/homebrew/bin` must come before `/bin` on `PATH`.

Verified versions (2026-10-19): Bun 1.4.3, Node 24.22.0, Podman 6.1.4, ripgrep 15.2.0, bash 5.3.

## Upstream

```bash
git submodule update --init --depth 1
cd vendor/opencode && bun install
cd packages/core && bun run test      # baseline: 6632 pass, 0 fail, 43 skip on v2.0.32
```

## Bobi

```bash
bun install                 # also links @opencode/* from vendor/opencode (scripts/link-upstream.ts)
bun run browser:install     # headless Chromium for the browser tool
bun run typecheck
bun run test                # Bobi tests only (vendor/ is ignored, see bunfig.toml)
bun run test:coverage       # fails below 80 % lines/functions
bun packages/shell/src/cli.ts            # interactive
bun packages/shell/src/cli.ts run "…"    # headless (close stdin when scripting: </dev/null)
```

Environment: `BOBI_MODEL_BASE_URL`, `BOBI_MODEL`, `BOBI_MODEL_API_KEY`, `BOBI_MODEL_PROTOCOL`, `BOBI_CONFIG`, `BOBI_USER`,
`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`.
