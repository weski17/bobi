# Third-party licenses

Every dependency must be listed here with its license before it is added (see CLAUDE.md).

| Component | Version / commit | License | Use in Bobi | Checked |
|---|---|---|---|---|
| OpenCode (`anomalyco/opencode`) | v2.0.31 / `180fd9d` (analysed) | MIT | Engine and server (fork, `vendor/opencode`) | 2026-10-17 |
| Code-OSS (`microsoft/vscode`) | `5e1d1ea5` (analysed) | MIT | IDE base (fork, `vendor/code-oss`) | 2026-10-17 |

Notes:
- MIT permits forking and redistribution; the copyright notices and license texts must be kept in the forks.
- Code-OSS: "Visual Studio Code", "VS Code" and their logos are Microsoft trademarks and must not appear in Bobi IDE.
- Transitive dependencies of both upstreams are checked when they are vendored (Phase 1 / Phase 4).
