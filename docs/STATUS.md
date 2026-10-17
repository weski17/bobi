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
| Approval of ADRs and open questions | ⏳ waiting for approval |

Not done in Phase 0 (on purpose): no code, no submodules, no dependencies installed.

## Key findings

1. OpenCode V2 has a plugin API strong enough to put almost all Bobi logic in `@bobi/core` without patching upstream.
2. **OpenCode allows every tool by default** – Bobi must invert this (ADR-0005).
3. OpenCode contacts vendor services by default (model catalog, updater, Console/Zen, Exa, …) – must be disabled (ADR-0003).
4. OpenCode has no browser tool and no ignore file → Bobi builds both.
5. Checkpoints only work in git projects.
6. Code-OSS ships a native chat + inline-diff stack; Bobi can reuse it via a built-in extension, but needs proposed APIs.
7. Both upstreams change very fast → depend only on public surfaces, pin to release tags.

## Open questions

1. **Runtime:** Bun 1.4.2 and Node 24 are not installed on this machine. May I install them (e.g. via Homebrew) in Phase 1?
2. **Upstream integration:** git submodules in this repo (ADR-0001) or a separate repo for the Code-OSS fork?
3. **Default model endpoint:** LiteLLM (`localhost:4000/v1`) or Ollama (`localhost:11434/v1`)?
4. **Non-git projects:** refuse write modes, or auto-create a private shadow repo for checkpoints?
5. **Container runtime:** Podman or Docker? Is a container already available on developer machines?
6. **CI:** GitHub Actions or an internal CI system?
7. **Browser tool:** headless Playwright (Apache-2.0) inside the sandbox – OK?

## Risks

- Very high upstream churn (OpenCode near-daily, V2 API not yet stable).
- IDE depends on proposed Code-OSS chat APIs.
- `.bobiignore` cannot fully stop indirect reads via shell → sandbox is the real boundary.
- Secrets inside user files end up in checkpoint snapshots.
