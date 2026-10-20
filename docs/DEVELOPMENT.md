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
bun packages/shell/src/cli.ts            # interactive terminal UI (own server in the bobi process)
bun packages/shell/src/cli.ts run "…"    # headless (close stdin when scripting: </dev/null)
bun packages/shell/src/cli.ts serve      # server only (IDE, container)
bun packages/shell/src/cli.ts attach URL # terminal UI against a running server
bun scripts/apply-patches.ts             # re-apply patches/opencode/* (also runs on bun install)
```

Environment: `BOBI_MODEL_BASE_URL`, `BOBI_MODEL`, `BOBI_MODEL_API_KEY`, `BOBI_MODEL_PROTOCOL`, `BOBI_CONFIG`, `BOBI_USER`,
`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`.

## Sandbox (Podman)

```bash
brew install podman && podman machine init && podman machine start
podman build -f sandbox/Containerfile -t bobi:dev .
export BOBI_SERVER_PASSWORD="$(openssl rand -base64 24)" BOBI_MODEL=<model> BOBI_MODEL_API_KEY=<key>
sandbox/bobi-sandbox.sh up ~/path/to/project
cd ~/path/to/project && bun ~/Documents/GitHub/bobi/packages/shell/src/cli.ts attach http://127.0.0.1:4096
sandbox/bobi-sandbox.sh status   # containers + egress decisions
sandbox/bobi-sandbox.sh down
```

Data: `BOBI_HOME` (default `~/.bobi`): `config.jsonc`, `custom_modes.yaml`, `rules*/`, `trust/projects.json`,
`data/bobi.db`, `data/shadow/` (checkpoint repositories of non-git projects), `data/log/server.log` (engine logs),
`tui/` (the terminal UI's own state).

## Bobi IDE (from source)

```bash
bun run ide:setup      # npm ci + compile in vendor/code-oss (Node 24), branding, Bobi extension
bun run ide [folder]   # or: bobi-ide [folder]
bun run test:ide       # integration test inside the IDE (opens a window)
```

- macOS: if `xcrun` picks a newer leftover SDK than the Command Line Tools, native modules fail with "unknown
  architecture"; `scripts/ide/env.ts` sets `SDKROOT` to the matching SDK automatically.
- After changing `packages/ide-extension`, `bun run ide` rebuilds and reinstalls the extension.
- Code-OSS patches live in `patches/code-oss/` and are applied by `bun scripts/apply-patches.ts`.

## Videos (`docs/media`)

Both videos are rendered frame by frame from HTML with Playwright's Chromium and encoded with ffmpeg
(`brew install ffmpeg`).

```bash
bun docs/media/bobi-intro/record.ts                    # 30 s intro (WebM, no audio)
# Feature tour with narration (Piper + Thorsten voice; see the header of make.ts for the download):
PIPER_BIN=<venv>/bin/piper PIPER_MODEL=<dir>/de_DE-thorsten-high.onnx ESPEAK_DATA_PATH=<espeak-ng-data> \
  bun docs/media/bobi-tour/make.ts                     # → bobi-tour.mp4, .m4a, .srt, .vtt
bun docs/media/bobi-tour/make.ts --stills              # one PNG per scene for review
```

Texts: `docs/media/bobi-tour/narration.json` (`text` = subtitle, optional `speak` = pronunciation). Scenes:
`tour.html` (timing comes from the measured narration, so picture, voice and subtitles stay in sync).
