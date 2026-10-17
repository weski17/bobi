# ADR-0001: Repository layout and upstream integration

- Status: Proposed
- Date: 2026-10-17

## Context

Bobi forks OpenCode (engine) and Code-OSS (IDE). Both move very fast: OpenCode ships near-daily (v2.0.26 → v2.0.31 in one week),
Code-OSS has many commits per day. CLAUDE.md requires minimal upstream changes so that upstream updates remain possible.

## Decision

- One Bobi monorepo (Bun workspace) for all Bobi-owned code: `packages/*`, `mcp-servers/*`, `defaults/`, `sandbox/`, `tests/`.
- Upstreams as **git submodules** under `vendor/opencode` and `vendor/code-oss`, pinned to **release tags**.
- Every upstream change is a numbered patch in `patches/<upstream>/NNNN-*.patch` with a header explaining why.
  `scripts/apply-patches.sh` applies them; CI fails if a patch no longer applies.
- Code-OSS branding via `overlays/code-oss/product.json`, merged at build time.
- Bobi code never lives inside `vendor/`.

## Alternatives considered

- Long-lived fork branches: simple at first, but rebases become opaque and upstream diffs are hard to review.
- git subtree: no submodule friction, but the 940 MB Code-OSS history would bloat the Bobi repo.
- Code-OSS in a separate repo: keeps Bobi light; may be revisited if submodule size hurts CI (open question).

## Consequences

- Upstream updates = bump tag + re-apply patches; patch count is a visible health metric.
- Developers need `git submodule update --init`; Code-OSS checkout is large (~1 GB).
