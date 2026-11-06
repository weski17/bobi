# Documentation map

Where everything lives. German user documentation first, then the engineering documents.

| Folder / file | What it is | Audience |
|---|---|---|
| [`../README.md`](../README.md) | Product overview, quick start | everyone |
| [`HANDBUCH.md`](HANDBUCH.md) | User manual (German): install, modes, features, demo, containers | users |
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Demo auf einem Linux-Server betreiben: Ausrollen, HTTPS, Betrieb | operators |
| [`GITHUB-AGENTS.md`](GITHUB-AGENTS.md) | Bobi als Prüfer in GitHub Actions: Tipps-Check, Review mit Modell auf eigenem Runner | operators |
| [`DEVELOPMENT.md`](DEVELOPMENT.md) | Prerequisites, build, test, IDE and container development | developers |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Components, request flow, security architecture, requirement mapping | developers, reviewers |
| [`adr/`](adr/README.md) | Architecture decision records (one decision per file, numbered) | developers, reviewers |
| [`security/`](security/) | Security reviews and the threat model; the policy is [`../SECURITY.md`](../SECURITY.md) | security, operators |
| [`STATUS.md`](STATUS.md) | Progress per phase and requirement | project owner |
| [`demos/`](demos/) | One demo script per phase (`phase-N.md`) | project owner |
| [`analysis/`](analysis/) | Clean-room analysis of the upstream projects (public sources only) | developers |
| [`examples/`](examples/) | Example configuration (`custom_modes.yaml`) | users |
| [`media/`](media/) | Videos and screenshots used by the documentation | – |

Files in the repository root: [`README.md`](../README.md) (product), [`SECURITY.md`](../SECURITY.md) (reporting and
policy), [`AGENTS.md`](../AGENTS.md) (rules for coding agents), [`CLAUDE.md`](../CLAUDE.md) (project context for the
development assistant), [`LICENSES.md`](../LICENSES.md) (every dependency with its licence).

Conventions: new decisions → new ADR; security findings → a dated file in `security/`; user-visible changes →
`HANDBUCH.md`; phase results → `STATUS.md` and `demos/`.
