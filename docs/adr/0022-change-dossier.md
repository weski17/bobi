# ADR-0022: Signed change dossier

- Status: Accepted (2026-11-03)
- Date: 2026-11-03

## Context

The audit log (ADR-0010) records every action, but a log file can be edited afterwards and says nothing about *what* was
done. For a company that has to answer "what did the AI change, who allowed it, did the tests pass?" it needs a
tamper-evident record per task.

## Decision

- Audit records carry a short, masked `bobi.detail` (shell command, file path, start of the prompt).
- `bobi dossier` turns the records of one session into a **hash chain** (`hash = sha256(canonical(event) incl. prev hash)`)
  and signs the head and the header (session, user, time, count) with the user's **Ed25519** key
  (`~/.bobi/keys/dossier-ed25519.pem`, mode 0600, created on first use). Only `node:crypto`; no new dependency.
- Optional extras join the chain: the result of a test command (`--test`) and the uncommitted diff (`--diff`, masked).
- `bobi dossier verify` recomputes the chain and checks the signature; with `--key` it also pins the signer.

## Model comparison (`bobi compare`)

- The same task runs once per model (2–4), one after another, each in its own `git worktree` of HEAD. The model is set
  through an extra config file (`BOBI_CONFIG`: default model, the mode's model, auto-approval of `edit` for that mode),
  so a per-mode model from the user's config cannot silently win.
- Auto-approval covers file edits only. Shell, network and external directories still ask; a headless run cannot answer,
  so they are refused and counted in the report. Bobi runs the test command itself after each run.
- Trust of the project is carried over to the worktree for the run and removed afterwards (`TrustStore.forget`).
- Tokens, tool calls and refusals come from the audit log (time window of the run); the model of each step is now part
  of the usage record (`bobi.model`).

## Consequences

- Detects editing, removing, adding and reordering of events, and truncation. It does **not** prove the dossier is
  complete (events that were never logged), and without a pinned key it does not prove who signed it.
- The diff is the state at sealing time. Prompts and details are masked by pattern; unknown secret formats can slip
  through (as everywhere, see SECURITY.md).
- Key loss means old dossiers can no longer be attributed; there is no revocation list yet.
- Per-task dossiers were added in [ADR-0026](0026-dossier-per-task.md). Possible later steps: anchoring the head in an
  external log, a per-task diff, signed registry for skills/modes/MCP servers.
