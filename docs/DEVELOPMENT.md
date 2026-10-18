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
