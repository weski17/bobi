# ADR-0020: Demo image with a bundled model, and continuous deployment

- Status: Accepted (2026-10-31, decided with the project owner)
- Date: 2026-10-31

## Context

Colleagues should be able to try every Bobi feature without installing anything or having a model gateway. Bobi
itself is only the tool (CLAUDE.md: "Bobi baut keine Modell-Infrastruktur"), so the demo is a **separate image**; the
product image stays small and model-free.

## Decisions

- **`bobi-demo` image** (`sandbox/Containerfile`, target `demo`) contains: the Bobi server, a local model server
  (**Ollama** v0.40.13, MIT, CPU backends only), the model **Qwen3-4B-Instruct-2507** (`q4_K_M`, 2.5 GB, Apache-2.0),
  a web terminal (**ttyd** 1.7.7, MIT) and the terminal client of the engine (`bobi attach`). All downloads are
  pinned to a version and verified (SHA-256 for Ollama and ttyd, the model blob digest for the model).
  The model stage runs on the build platform once and is copied into both architectures (amd64 and arm64).
- **Model choice:** Apache-2.0 (redistributable inside the image), tool calling in Ollama's template (Bobi's agent
  loop needs it), no "thinking" phase (on CPUs it would multiply latency), small enough for 8 GB RAM.
  Qwen2.5-Coder 3B was rejected (research licence); 7B (4.7 GB) is too slow on CPUs for a shared demo.
  Bobi's first request is about 5k tokens, so the context window is 16k (`OLLAMA_CONTEXT_LENGTH`, q8 KV cache).
- **No internet for the demo:** the model is in the image, so the container sits on an internal network
  (`compose.demo.yaml`); a gateway container forwards the single published port (7681) with the existing
  `sandbox/forward.ts`. Ollama (11434) and the Bobi server (4096) are bound to loopback inside the container.
- **Web terminal as the user interface:** one login (`demo` + `DEMO_PASSWORD`, required, ≥ 12 characters), then a
  menu: Bobi (interactive), tips, examples, code tips, COBOL diagram, usage/audit, A2A card, shell, reset. Every
  browser session works on a private copy of a sample project (TypeScript with a bug and a complex function,
  `.bobiignore` with fake secrets, project rules/skills/commands/mode, a COBOL/JCL sample). Project trust is
  granted for that sample only (`--trust`). Approvals work as everywhere: the visitor answers them.
  Plain HTTP is documented as trusted-network only; TLS via reverse proxy or mounted certificate.
- **Hardening:** non-root, all capabilities dropped, `no-new-privileges`, read-only root filesystem (tmpfs for
  `/tmp`), pids/memory/CPU limits, internal network.
- **CI/CD** (`.github/workflows/image.yml`, `deploy.yml`): both images are built for amd64 and arm64. The demo is
  first built for amd64 and **tested end to end** (`tests/sandbox/demo.test.ts` incl. a real agent turn with the
  bundled model); only then is it pushed, and `latest` exists only for tested images. Pull requests touching the
  image build and test without publishing. Deployment is a manual or post-build workflow that logs in to a server
  over SSH (host key pinned via `DEPLOY_KNOWN_HOSTS`), copies `compose.demo.yaml`, pulls the tested `sha-<commit>`
  image with the job's own token and restarts it; the demo password stays in the server's `.env` and is never
  stored in GitHub. Without the deployment variables and secrets the workflow does nothing.
- **Registry:** GitHub Packages, private (ADR-0019); `ghcr.io/weski17/bobi-demo`.

## Consequences

- The image is large (about 6 GB on disk, 3–4 GB to pull); the model layer is shared by both architectures.
- CPU inference is slow: expect seconds to minutes per answer, and the 4B model is far weaker than a gateway
  model. The demo is for exploring features, not for judging model quality.
- All visitors share one model process (`OLLAMA_NUM_PARALLEL=2`), one login and one Bobi server; sessions and
  files are separate, usage and audit of the demo are shared.
- Autocomplete and the IDE are not part of the web demo (the IDE is a desktop app; autocomplete needs a
  fill-in-the-middle model).
- Docker needs the `buildx` plugin for these Containerfiles (`brew install docker-buildx` on macOS); Podman works as is.
