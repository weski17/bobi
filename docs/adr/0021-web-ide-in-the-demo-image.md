# ADR-0021: Web IDE in the demo image (experimental, opt-in)

- Status: Accepted as **experimental** (2026-10-31, decided with the project owner)
- Date: 2026-10-31

## Context

Testers use Windows, macOS and Linux. Bobi IDE as a desktop application is built per operating system, but the demo
should need nothing but a browser. Code-OSS ships an official web build (`vscode-reh-web`, a server that serves the
workbench to a browser and runs the extensions on the server). That is the same upstream code base as Bobi IDE, so no
new base is introduced. The web terminal of the demo (ADR-0020) already offers every Bobi feature; the web IDE would add
the graphical chat panel, diffs and the editor.

## What was built and verified

- **Build:** the `webide` stage of `sandbox/Containerfile` fetches the pinned upstream revision, applies
  `patches/code-oss` (new: `0003`, the upstream web-server task failed without the Copilot SDK), applies the branding,
  copies the Bobi chat extension and runs the upstream gulp task `vscode-reh-web-linux-<arch>-min` on Debian 13 (the gcc
  of Debian 12 cannot compile the Electron headers of this revision). Result: 662 MB, verified for arm64.
- **Opt-in:** the stage builds only with `--build-arg WEB_IDE_ARCHS="amd64"` (needs ~8 GB RAM, ~10 minutes); by default
  the stage is empty, so the standard demo image stays small and its CI build short.
- **Access:** the IDE server listens on 127.0.0.1:8080; **nginx** on port 7683 is the only way in (HTTP Basic, user
  `demo`, same `DEMO_PASSWORD` as the terminal; WebSocket support; Origin check against cross-site WebSocket hijacking;
  `Cache-Control: no-cache`, because the IDE's file names contain the upstream commit and do not change on rebuilds).
  `compose.demo.yaml` publishes it through a second forwarder (`--profile ide`).
  A Bun reverse proxy was tried first and rejected: its WebSocket client sent frames the IDE server refused.
- **Works:** workbench in the browser, shared sample workspace, dark theme, the Bobi activity-bar entry, the extension
  runs (Bobi's own project-trust prompt appears; the demo pre-trusts the sample project). The extension declares that it
  supports restricted mode (`capabilities.untrustedWorkspaces`), because Bobi has its own project trust (ADR-0014).

## Open problem (why it is experimental)

The chat panel is a VS Code *webview*. Webviews run on their own origin: the page must be served from a host name that
starts with a hash of the workbench origin (`<hash>.<domain>`), and the default is a Microsoft CDN, which has no place in
an on-premise product. Serving webviews ourselves needs a **wildcard DNS name and a wildcard TLS certificate** for the
host (or `*.localhost` for local tests) plus a server patch that hands the template to the client. That is too much to
ask for "just try it"; until it is solved the panel stays empty. Options for later: (a) document the wildcard setup and
add the patch, (b) render the chat without a webview (VS Code chat participant API), (c) a small standalone web chat
served by the Bobi server itself.

**Update 2026-11-03:** option (c) was built as the [web chat](0024-web-chat.md) (port 7682, always on). The web IDE moved to port 7683 and stays experimental.

## Consequences

- The standard demo is unchanged: web terminal, bundled model, all features.
- The web IDE code stays in the repository, tested up to the point described above, and does not affect the default image.
- Anyone enabling it runs commands in an IDE terminal inside the (unprivileged, read-only, internet-less) container; all
  visitors share one workspace.
