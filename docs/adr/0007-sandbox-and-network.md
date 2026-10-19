# ADR-0007: Sandbox and network allowlist

- Status: Accepted (2026-10-19)
- Date: 2026-10-17

## Context

Agents must run in a container without access to production data, with network access only to approved targets.
`.bobiignore` and permissions alone are not a security boundary.

## Decision

- The Bobi server and all tool processes run in a rootless OCI container (**Podman**, rootless – decided 2026-10-19; Docker-compatible so Docker also works).
  Only the project directory and a Bobi data volume are mounted; no host home, no SSH agent, no cloud credentials.
- Default network: none. Egress only via an allowlist proxy in `sandbox/` (model gateway, configured MCP hosts, approved URLs).
- IDE and Shell run on the host and talk to the server over a local port with a per-session password.
- A "no sandbox" developer mode exists for Phase 1 work but prints a warning and is never the default in releases.

## Consequences

- Shell commands run inside the container → the developer's host toolchain must be available in the image (image per stack).
- Red-team tests cover sandbox escape and egress.

## Phase 1 notes (2026-10-19)

- Runtime: **Podman** (rootless VM on macOS). Image `sandbox/Containerfile` based on `oven/bun:1.4.3` (pinned by digest),
  runs as uid 1000, with git, ripgrep and headless Chromium.
- `sandbox/bobi-sandbox.sh up <project>` starts two containers:
  - `bobi-server` – only on the internal network `bobi-internal` (no route out), project mounted at the **same absolute
    path** so client and server agree on paths, published on `127.0.0.1:4096`, `--cap-drop all`, `no-new-privileges`.
  - `bobi-egress` – `@bobi/egress-proxy`, the only container on both networks; allows only `BOBI_EGRESS_ALLOW`
    (default: the LiteLLM gateway on the host) and logs every decision as JSON.
- The TUI on the host connects with `bobi attach http://127.0.0.1:4096`.
- Raw TCP from the server container has no route out; HTTP(S) honours `HTTP(S)_PROXY`.
