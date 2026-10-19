# Bobi

Bobi is an on-premise AI development partner for internal developers: it plans, reads and edits code, runs commands
and browses internal pages – with your company's own models, and without code or data leaving the network.
Research project; see [`CLAUDE.md`](CLAUDE.md) for goals and rules and [`docs/STATUS.md`](docs/STATUS.md) for progress.

- **Engine:** a pinned fork of [OpenCode](https://github.com/anomalyco/opencode) (MIT) in `vendor/opencode`
- **Bobi:** its own application on top – secure defaults, offline configuration, audit, sandbox ([architecture](docs/ARCHITECTURE.md))

## Quick start

```bash
brew install oven-sh/bun/bun ripgrep bash
git clone --recurse-submodules https://github.com/weski17/bobi.git && cd bobi
(cd vendor/opencode && bun install) && bun install && bun run browser:install
bash scripts/install.sh            # puts `bobi` into ~/.local/bin

export BOBI_MODEL_BASE_URL=http://localhost:4000/v1 BOBI_MODEL=<model id> BOBI_MODEL_API_KEY=<key>
cd ~/your/project && bobi           # terminal UI
bobi run "explain this repository"  # headless
```

Configuration: [`bobi.example.jsonc`](bobi.example.jsonc). Sandbox: [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md#sandbox-podman).
Demos: [phase 1](docs/demos/phase-1.md), [phase 2](docs/demos/phase-2.md), [phase 3](docs/demos/phase-3.md), [phase 4](docs/demos/phase-4.md), [phase 5](docs/demos/phase-5.md).

## Modes

`code` (default), `plan`, `ask`, `advanced`, `orchestrator` – switch with Shift+Tab. Own modes in
`.bobi/custom_modes.yaml` ([example](docs/examples/custom_modes.yaml)), rules in `.bobi/rules/` and `AGENTS.md`
(`/init` writes it), exclusions in `.bobiignore`. Demo: [`docs/demos/phase-2.md`](docs/demos/phase-2.md).

## MCP

Built-in **code graph** server (call chains, dependencies) in Advanced mode; own local or remote MCP servers in
`config.jsonc` with credentials from the environment. Demo: [`docs/demos/phase-3.md`](docs/demos/phase-3.md).

## Bobi IDE

Code-OSS with Bobi branding and the Bobi chat panel: diff before apply, context from open tabs, modes, one-click undo.
`bun run ide:setup` once, then `bobi-ide ~/your/project`. Demo: [`docs/demos/phase-4.md`](docs/demos/phase-4.md).

## Workflows

Orchestrator that delegates to modes, Security mode, `/commit`, `/pr`, `/security-review`, own slash commands and
skills, literate coding in the IDE (Cmd+Alt+Enter). Demo: [`docs/demos/phase-5.md`](docs/demos/phase-5.md).

## Safeguards

- Every write, shell command and network action asks for approval; auto-approval only through explicit, versioned config.
- Only the configured model endpoint is contacted (tested); vendor services are switched off.
- Tool output is marked as untrusted data; secrets are masked; every action is audited via OpenTelemetry.
- In the sandbox the server runs unprivileged without network access except through an allowlist proxy.

## License

Bobi's own code: [MIT](LICENSE), © Finanz Informatik GmbH & Co. KG.
The engine in `vendor/opencode` keeps its own MIT license and copyright. Third-party components: [`LICENSES.md`](LICENSES.md).
