# ADR-0019: Container distribution – Docker Compose and GitHub Packages

- Status: Accepted (2026-10-23, decided with the project owner)
- Date: 2026-10-23

## Context

Bobi's server already ran in a Podman sandbox (ADR-0007, `sandbox/bobi-sandbox.sh`). Teams asked for the usual
Docker workflow: `docker compose up` and a ready-made image they can pull.

## Decisions

- **`compose.yaml`** next to the Podman script, with the same security model: `server` unprivileged, no
  capabilities, only on an internal network; `egress` (allowlist proxy) is the only way out; `gateway` forwards
  `127.0.0.1:4096` to the server, because Docker does not publish ports of containers that are only on an internal
  network (`sandbox/forward.ts`, a byte forwarder with back-pressure); `mock-model` as profile `demo`.
  `.bobiignore`'d files are hidden by a generated `compose.override.yaml` (`sandbox/compose-masks.ts`), which Compose
  loads automatically. `.containerignore` became `.dockerignore`, read by both Docker and Podman.
- **Docker on macOS without Docker Desktop:** Colima + Docker CLI + Compose plugin (MIT / Apache-2.0). Docker
  Desktop needs a paid subscription for companies of Finanz Informatik's size.
- **Registry:** GitHub Packages, `ghcr.io/weski17/bobi`, **private** like the repository (the image contains the
  full source). Built and pushed by `.github/workflows/image.yml` on every push to `main` and on `v*` tags, with the
  workflow's own `GITHUB_TOKEN` – no stored credentials. Docker Hub was not chosen: a public repository would
  publish the private code; a private one needs another account and token.
- **Platforms:** linux/amd64 (servers) and linux/arm64 (Apple silicon); the base image is pinned to the
  multi-platform index digest of `oven/bun:1.4.3`.

## Consequences

- The arm64 half is built under QEMU in CI and takes noticeably longer than the amd64 half.
- Pulling needs a GitHub login with `read:packages`; making the image public later is a package setting, not a
  code change.
- `tests/sandbox/compose.test.ts` covers the Compose setup end to end (runs when Docker and the image exist).
