# Third-party licenses

Every dependency must be listed here with its license before it is added (see CLAUDE.md).

| Component | Version / commit | License | Use in Bobi | Checked |
|---|---|---|---|---|
| OpenCode (`anomalyco/opencode`) | v2.0.32 (submodule `vendor/opencode`) | MIT | Engine and server (fork, `vendor/opencode`) | 2026-10-17 |
| AWS CardDemo (`aws-samples/aws-mainframe-modernization-carddemo`) | commit `59cc6c2` (submodule `vendor/carddemo`) | Apache-2.0 | COBOL test object for the COBOL MCP server (tests and demos only, not shipped, excluded from the sandbox image) | 2026-10-19 |

Notes:
- MIT permits forking and redistribution; the copyright notices and license texts must be kept in the forks.
- Code-OSS: "Visual Studio Code", "VS Code" and their logos are Microsoft trademarks and must not appear in Bobi IDE.
- Transitive dependencies of both upstreams are checked when they are vendored (Phase 1 / Phase 4).

## Developer tools (not shipped with Bobi)

| Tool | License | Use |
|---|---|---|
| Bun | MIT | Runtime, package manager, test runner |
| Node.js 24 | MIT | Runtime for Code-OSS tooling |
| Podman | Apache-2.0 | Container sandbox |
| ripgrep | MIT / Unlicense | Code search used by OpenCode (must be preinstalled, see docs/DEVELOPMENT.md) |
| GNU bash 5 | GPL-3.0 | Shell used by tests; not linked or distributed |
| ffmpeg 9 (Homebrew) | LGPL-2.1 / GPL-2.0 (build with x264) | Encodes the demo videos in `docs/media`; dev machine only, not shipped |
| Piper TTS (`piper-tts` 1.8.0, PyPI) | GPL-3.0-or-later | Generates the tour narration on a dev machine; not shipped, not in the repository |
| Piper TTS binary (`rhasspy/piper` release 2023.11.14-2, `piper_linux_aarch64`) | MIT | Narration of `docs/media/bobi-showcase` on a dev machine, run in a container (`oven/bun` image) because the release's macOS build is x86_64 only; not shipped, not in the repository |
| Piper voice `de_DE-thorsten-high` (Hugging Face `rhasspy/piper-voices`) | Model MIT; Thorsten-Voice dataset CC0 | Narration voice of `docs/media/bobi-tour/bobi-tour.mp4` and `docs/media/bobi-showcase/bobi-showcase.mp4`; the model file is not in the repository |
| macOS speech voice "Anna" (`say`) | Apple macOS licence: personal, non-commercial use only | Fallback in `make.ts` for drafts only; the published tour uses Piper |
| Docker Buildx (Homebrew) | Apache-2.0 | `docker build` with the multi-stage, multi-platform Containerfile; dev machines |
| Colima | MIT | Linux VM for Docker on macOS (instead of Docker Desktop, which needs a paid licence in large companies) |
| Docker CLI, Docker Compose plugin (Homebrew) | Apache-2.0 | `docker build`, `docker compose` for `compose.yaml`; dev machines and servers |
| promptfoo 0.123.1 | MIT | Red-team runner (`bun run test:redteam`, via npx, pinned); telemetry, update checks and remote generation switched off; not installed in the workspace |

## Components shipped only in the demo image (`ghcr.io/weski17/bobi-demo`)

Not part of the Bobi product image. Versions are pinned in `sandbox/Containerfile`; downloads are verified by SHA-256
or blob digest. License texts are in the image under `/opt/demo/licenses/`.

| Component | Version | License | Use |
|---|---|---|---|
| Ollama (`ollama/ollama`) | v0.40.13 (CPU backends only) | MIT | Local model server (includes llama.cpp/ggml, MIT) |
| Qwen3-4B-Instruct-2507, quantisation `q4_K_M` (Ollama library `qwen3:4b-instruct-2507-q4_K_M`) | blob `sha256-85e4a5b7…18b9` | Apache-2.0 | Bundled demo model |
| ttyd (`tsl0922/ttyd`) | 1.7.7 (static release binaries) | MIT (statically linked libraries under permissive licences, see the ttyd release) | Terminal in the browser |
| nginx (`nginx-light`, Debian package) | Debian 13 | BSD-2-Clause | Optional web IDE: password gate and WebSocket proxy (demo image) |
| curl, less, nano (Debian trixie packages) | distribution | curl: curl license; less: GPL-3.0/BSD-2; nano: GPL-3.0 | Health checks and a pager/editor in the demo shell; unmodified Debian packages |

## Bobi workspace dependencies

| Package | Version | License | Use |
|---|---|---|---|
| typescript | 5.8.2 | Apache-2.0 | Typecheck (dev); runtime parser of the code graph MCP server |
| @types/bun | 1.4.0 | MIT | Bun type definitions (dev) |
| `@opencode/*`, effect | from `vendor/opencode` | MIT | Linked from the pinned submodule by `scripts/link-upstream.ts`, never installed from npm |
| playwright-core | 1.63.0 | Apache-2.0 | Headless browser tool (`@bobi/browser`) |
| Chromium headless shell (via Playwright) | build 1243 | BSD-3-Clause and others (see Playwright `ThirdPartyNotices.txt`) | Browser binary, installed with `bun run browser:install`; not committed |

## CI tools (not shipped)

| Tool | Version | License | Use |
|---|---|---|---|
| Semgrep CE (`semgrep/semgrep` image) | 1.178.0 | LGPL-2.1 (engine); rules from the Semgrep Registry under their own terms | Static analysis in CI |
| GitHub Actions `actions/checkout`, `oven-sh/setup-bun` | v4, v2 | MIT | CI |
| GitHub Actions `docker/setup-qemu-action`, `setup-buildx-action`, `login-action`, `metadata-action`, `build-push-action`, `actions/setup-node` | v3, v3, v3, v5, v6, v4 | Apache-2.0 (docker/*), MIT (setup-node) | Image build and push to GitHub Packages; Node for the red team |
| ignore | 7.0.11 | MIT | `.bobiignore` matching with gitignore semantics (`@bobi/core`) |
| @modelcontextprotocol/server | 2.4.0 | MIT | Code graph MCP server (`mcp-servers/code-graph`), test fixtures |
| @modelcontextprotocol/client | 2.4.0 | MIT | MCP protocol tests (dev) |
| @modelcontextprotocol/core | 2.4.0 | MIT | Transitive (MCP SDK) |
| zod | 4.6.7 | MIT | Transitive (MCP SDK) |
| Code-OSS (`microsoft/vscode`) | 1.141.2 (submodule `vendor/code-oss`) | MIT | Bobi IDE base; branding overlay `scripts/ide/brand.ts`, patches `patches/code-oss/` |
| @types/vscode | 1.100.0 | MIT | Extension API types (dev) |
| diff | 8.0.4 | BSD-3-Clause | Extension tests: produce patches like the engine (dev) |
