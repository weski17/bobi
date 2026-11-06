# Image scan (Trivy) – how the gate works

The image workflow scans the demo image with Trivy (`HIGH` and `CRITICAL`, only findings that have a fix) after the
build. A finding that is **not** listed in [`.trivyignore.yaml`](../../.trivyignore.yaml) fails the workflow, so the
image is not published.

## The baseline (2026-11-06)

Trivy reported 53 distinct findings that day. None is in Bobi's own code; they come from:

- npm dependencies of the pinned engine (`vendor/opencode/node_modules`: e.g. `vite`, `seroval`, `undici`,
  `fast-xml-parser`, `js-yaml`, `brace-expansion`, an older MCP SDK),
- the engine's build tools `esbuild` and `tsgo` (Go binaries, so the Go standard library is flagged),
- the Debian base image (`apt`).

Bobi does not patch vendor code for this (CLAUDE.md: change upstream as little as possible). The findings go away
when the engine submodule or the base image is updated. Bobi's own MCP SDK is already at 2.4.0.

**What the baseline is not:** it is not a statement that these findings are harmless. Whether they are reachable in
the demo has not been analysed. The demo has no internet access and no production data, which limits the damage, but
that is a mitigation, not an analysis.

## Rules

1. A new finding fails the build. Fix it (update the dependency or base image) or, after looking at it, add an entry
   with a real reason.
2. Every entry has `expired_at`. After that date the finding fails the build again until it is re-checked. The
   baseline expires on **2027-02-06**.
3. When the engine or the base image is updated, delete the entries that are gone (run the scan, compare). Stale
   entries are harmless but hide that the baseline shrinks.
4. Never add entries just to make a build pass.

## Reproduce locally

```bash
docker build -f sandbox/Containerfile --target demo -t bobi-demo:ci .
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$PWD/.trivyignore.yaml:/.trivyignore.yaml:ro" \
  aquasec/trivy:0.57.0 image --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --scanners vuln \
  --ignorefile /.trivyignore.yaml bobi-demo:ci
```
