# Security policy

Bobi is an on-premise development assistant: it reads code, runs commands and talks to a model endpoint. Security is
therefore part of the product, not an add-on. This file explains how to report problems and what Bobi guarantees (and
does not guarantee). The design is in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#5-security-architecture); reviews
are in [`docs/security/`](docs/security/).

## Reporting a vulnerability

Please **do not open a public issue** for a vulnerability. Use GitHub's private reporting: *Security → Report a
vulnerability* in this repository. Describe what you found, how to reproduce it and what an attacker gains. Do not
include real secrets or production data. You will get an answer to your report; fixes are published on `main`.

Supported version: the current `main` branch (Bobi is a research project; there are no maintained release branches).

## What Bobi protects (and how)

| Concern | Protection |
|---|---|
| Code and data leave the network | Only the configured model endpoint is contacted; vendor services of the engine are disabled; tested. |
| Unwanted actions | Every write, terminal command, network access and MCP call asks for approval by default; auto-approval only by explicit, versioned settings. Protected paths (`.bobi/`, `.bobiignore`, mainframe writes) always ask. |
| Prompt injection | Content from files, web pages, terminal output and MCP responses is marked as untrusted data; permissions are enforced by Bobi, never by the model. A promptfoo red-team suite with a compromised model runs in CI. |
| Secrets | Masked in prompts, tool output, logs, audit records and checkpoints; keys only from environment variables. |
| Foreign repositories | Project configuration is used only after the user trusts the project (fingerprint, asked again on change). |
| Isolation | The sandbox image runs unprivileged, read-only, without capabilities; network only through an allowlist proxy. |
| Accountability | Every action is audited with user, mode, tool and result (OpenTelemetry and JSONL). |

## The demo image (`bobi-demo`)

The demo exists so that others can try Bobi; treat it as an exposed service:

- Access needs the password you set (`DEMO_PASSWORD`, at least 12 characters, otherwise the container refuses to
  start). The web terminal (ttyd), the web chat and the optional, experimental web IDE use the same user (`demo`) and password;
  there is no default password.
- **Use TLS outside a trusted network.** The password and all keystrokes travel over the connection. Put a TLS
  reverse proxy in front or mount a certificate (see `compose.demo.yaml`).
- The container has **no internet access** (internal network), runs as an unprivileged user on a read-only file
  system with all capabilities dropped and `no-new-privileges`. The model server and the Bobi server listen on
  loopback only.
- Anyone with the password can run commands **inside that container** (terminal, IDE terminal). That is by design;
  the container boundary is the protection. Do not mount host directories or secrets into it.
- The terminal gives each session a private copy of the sample project; the optional web IDE shares one workspace.
- Use a long random password, rotate it after events, and do not publish it.

## Supply chain

- Dependencies are pinned (`bun.lock`, exact versions, container base images by digest, downloaded binaries by
  SHA-256). Every new dependency is checked for its licence and recorded in [`LICENSES.md`](LICENSES.md).
- Every pull request and push runs the security gate ([docs/security/security-gate.md](docs/security/security-gate.md)):
  Semgrep (TypeScript and secrets rules), gitleaks (secrets in new commits), `bun audit` (high and above) and Trivy
  (misconfigurations); a pull request fails on what it adds. An optional Bobi agent comments on the change, read-only
  and advisory. CI also runs the red-team suite.
- Upstream code (`vendor/`) is tracked by commit; changes to it are numbered patches in `patches/` with a reason.

## Known limits

- A small local model can be steered by hostile content more easily than a large one; the permission system, not
  the model, is what stops harmful actions. Keep approvals on for untrusted projects.
- The sandbox protects the host, not the project: a mounted project is writable by an approved agent.
- The web chat (port 7682) forwards only the API calls the chat needs to the Bobi server, checks the `Origin` header and sets a strict content security policy ([ADR-0024](docs/adr/0024-web-chat.md)). All visitors share its workspace.
- The web IDE is experimental and not part of the standard demo image (see [ADR-0021](docs/adr/0021-web-ide-in-the-demo-image.md)).
