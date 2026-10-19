# Third-party licenses

Every dependency must be listed here with its license before it is added (see CLAUDE.md).

| Component | Version / commit | License | Use in Bobi | Checked |
|---|---|---|---|---|
| OpenCode (`anomalyco/opencode`) | v2.0.32 (submodule `vendor/opencode`) | MIT | Engine and server (fork, `vendor/opencode`) | 2026-10-17 |

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
| ignore | 7.0.11 | MIT | `.bobiignore` matching with gitignore semantics (`@bobi/core`) |
| @modelcontextprotocol/server | 2.0.0 | MIT | Code graph MCP server (`mcp-servers/code-graph`), test fixtures |
| @modelcontextprotocol/client | 2.0.0 | MIT | MCP protocol tests (dev) |
| @modelcontextprotocol/core | 2.0.0 | MIT | Transitive (MCP SDK) |
| zod | 4.6.7 | MIT | Transitive (MCP SDK) |
| Code-OSS (`microsoft/vscode`) | 1.141.2 (submodule `vendor/code-oss`) | MIT | Bobi IDE base; branding overlay `scripts/ide/brand.ts`, patches `patches/code-oss/` |
| @types/vscode | 1.100.0 | MIT | Extension API types (dev) |
| diff | 8.0.4 | BSD-3-Clause | Extension tests: produce patches like the engine (dev) |
