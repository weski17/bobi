# ADR-0026: Change dossier per task

- Status: Accepted (2026-11-06)
- Date: 2026-11-06

## Context

ADR-0022 seals the dossier of a whole session. A session often holds several prompts ("fix the rounding", later "add a
test", later something unrelated). For a review or an audit one wants the record of *one* task, not everything the
person did in that session.

## Decision

- A **task** is one prompt: it starts with a `bobi.task` audit record and runs up to the next one in the same session.
  Records before the first task record of a session belong to the first task, so nothing is left out.
- `bobi dossier --task N|last [--session ID]` seals only that task. `bobi dossier --list --session ID` lists the tasks
  (number, time, mode, number of records, start of the prompt); the session list shows the number of tasks.
- The dossier gets an optional field `task` (1-based). It is part of the **signed header** only when present, so older
  dossiers verify exactly as before and a task dossier cannot be passed off as a whole session or as another task, and
  the reverse: adding, removing or changing `task` breaks the signature.
- Task numbers are positions in the audit log of that session. They are stable as long as the log is only appended to,
  which is how Bobi writes it.
- No new dependency. The command moved from `app.ts` into `packages/shell/src/dossier.ts`.

## Not included

- **A per-task diff.** Bobi does not record the working tree at the start and end of a task, so `--diff` is still the
  project's uncommitted state at sealing time. With `--task` the command says so. Per-task diffs would need a
  checkpoint reference in the audit records.
- **Tasks across sessions** (a piece of work that spans a new session) and merging several task dossiers into one.

## Consequences

- Tasks with no `bobi.task` record at all (a session that only has tool records) form a single task.
- Two sessions that share one audit log are never mixed: tasks are always cut per session.
