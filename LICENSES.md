# Third-party licenses

Every dependency must be listed here with its license before it is added (see CLAUDE.md).

| Component | Version / commit | License | Use in Bobi | Checked |
|---|---|---|---|---|
| OpenCode (`anomalyco/opencode`) | v2.0.32 (submodule `vendor/opencode`) | MIT | Engine and server (fork, `vendor/opencode`) | 2026-10-17 |
| Code-OSS (`microsoft/vscode`) | `5e1d1ea5` (analysed) | MIT | IDE base (fork, `vendor/code-oss`) | 2026-10-17 |

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
