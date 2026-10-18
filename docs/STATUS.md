# Status

**Current phase: 0 – analysis, architecture, ADRs** · Branch `phase-0-architecture`

## Phase 0

| Task | Status |
|---|---|
| Analyse OpenCode | ✅ [docs/analysis/opencode.md](analysis/opencode.md) |
| Analyse Code-OSS | ✅ [docs/analysis/code-oss.md](analysis/code-oss.md) |
| Architecture and folder structure | ✅ proposed – [docs/ARCHITECTURE.md](ARCHITECTURE.md) |
| ADRs 0001–0011 | ✅ proposed – [docs/adr/](adr/README.md) |
| LICENSES.md | ✅ |
| Demo guide | ✅ [docs/demos/phase-0.md](demos/phase-0.md) |
| Approval of ADRs and open questions | ✅ approved 2026-10-19 |

Not done in Phase 0 (on purpose): no code, no submodules, no dependencies installed.

## Key findings

1. OpenCode V2 has a plugin API strong enough to put almost all Bobi logic in `@bobi/core` without patching upstream.
2. **OpenCode allows every tool by default** – Bobi must invert this (ADR-0005).
3. OpenCode contacts vendor services by default (model catalog, updater, Console/Zen, Exa, …) – must be disabled (ADR-0003).
4. OpenCode has no browser tool and no ignore file → Bobi builds both.
5. Checkpoints only work in git projects.
6. Code-OSS ships a native chat + inline-diff stack; Bobi can reuse it via a built-in extension, but needs proposed APIs.
7. Both upstreams change very fast → depend only on public surfaces, pin to release tags.

## Decisions (2026-10-19)

All ADRs 0001–0011 accepted. Open questions answered:

1. **Runtime:** install Bun and Node 24 via Homebrew in Phase 1.
2. **Upstreams:** `vendor/opencode` as submodule in Phase 1; `vendor/code-oss` only in Phase 4.
3. **Default model endpoint:** **LiteLLM** at `http://localhost:4000/v1`.
4. **Non-git projects:** auto-create a private shadow repo for checkpoints.
5. **Container runtime:** Podman (neither Docker nor Podman is installed yet).
6. **CI:** GitHub Actions.
7. **Browser tool:** headless Playwright (Apache-2.0).

## Open questions

1. **Logo:** the supplied logo is a company logo with a third-party trademark. Branding is kept configurable
   and out of the public repo until usage rights are confirmed (see ADR-0012).

## Risks

- Very high upstream churn (OpenCode near-daily, V2 API not yet stable).
- IDE depends on proposed Code-OSS chat APIs.
- `.bobiignore` cannot fully stop indirect reads via shell → sandbox is the real boundary.
- Secrets inside user files end up in checkpoint snapshots.
