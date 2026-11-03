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

## Consequences

- Detects editing, removing, adding and reordering of events, and truncation. It does **not** prove the dossier is
  complete (events that were never logged), and without a pinned key it does not prove who signed it.
- The diff is the state at sealing time. Prompts and details are masked by pattern; unknown secret formats can slip
  through (as everywhere, see SECURITY.md).
- Key loss means old dossiers can no longer be attributed; there is no revocation list yet.
- Possible later steps: anchoring the head in an external log, dossiers per task instead of per session, signed
  registry for skills/modes/MCP servers.
