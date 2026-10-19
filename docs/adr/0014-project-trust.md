# ADR-0014: Project trust

- Status: Accepted (2026-10-19, approved by the project owner)
- Date: 2026-10-19

## Context

Files in a repository steer Bobi: `AGENTS.md`, `.bobi/rules*`, `.bobi/custom_modes.yaml` and `.bobi/config.jsonc` – the
latter can even add auto-approvals or point the model endpoint elsewhere. A cloned foreign repository could use them
to instruct the model or widen rights. Permissions are engine-enforced, but auto-approvals from the repository are
explicit allow rules.

## Decision

- **Trust per project**, like workspace trust in IDEs. A project that contains any of these files is *unknown* until
  the user decides; projects without them need no decision.
- Decisions are stored in `$BOBI_HOME/trust/projects.json` (mode 0600) with a **SHA-256 fingerprint** of those files;
  any change makes the project *unknown* again. Decided for the project root (nearest `.bobi` or `.git`).
- **Untrusted** (or unknown): the project's AGENTS.md, rules, custom modes and `.bobi/config.jsonc` are ignored.
  `.bobiignore` still applies – it only restricts Bobi.
- `bobi`, `bobi run` and `bobi attach` ask once in the terminal (listing the files). Without a terminal the project
  stays untrusted unless `--trust` is given.
- The server re-checks trust itself (same store); the sandbox mounts `$BOBI_HOME/trust/` read-only.

## Consequences

- One extra question per new project with Bobi files, and after changes to them.
- Editing `.bobi/` files is protected anyway (always asks), so the agent cannot silently trust itself into rights.
