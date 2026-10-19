# ADR-0006: Checkpoints and undo

- Status: Accepted (2026-10-19)
- Date: 2026-10-17

## Context

OpenCode creates shadow-git snapshots (`core/src/snapshot.ts`) and exposes a revert API, but **only for git projects**.
Snapshots store file content, so secrets in the working tree end up in the snapshot store.

## Decision

- Use OpenCode snapshots and revert API unchanged; the IDE/Shell "undo" button calls `POST /api/session/:id/revert/*`.
- For non-git projects: **auto-initialise a private shadow repo** in the Bobi data directory (not inside the project), so undo always works (decided 2026-10-19).
- Snapshot store lives inside the sandbox volume, never synced elsewhere; files matched by `.bobiignore` and secret patterns
  are excluded where the snapshot API allows it (to verify in Phase 1).

## Consequences

- Undo is reliable for git repos from day one. Masking secrets *inside* user files in snapshots is not fully possible;
  documented as residual risk.

## Phase 1 notes (2026-10-19)

- Verified: revert restores changed files and removes created files in git projects.
- Non-git projects: implementation choice still open (pointer `.git` file vs. own file backup), see docs/STATUS.md.

## Decision for non-git projects (2026-10-19)

- Bobi creates a hidden repository under `~/.bobi/data/shadow/<hash>.git` with `git init --separate-git-dir`; the
  project only gets a `.git` **pointer file**. A root commit gives the project a stable identity in the engine.
- Created by `bobi`, `bobi run` and `bobi attach`; the sandbox mounts the shadow directory at the same path.
- Side effect (accepted): `git` commands in that folder see this repository. Running `git init` there reinitialises it.
- Tested: revert restores a changed file in a project without git; the pointer resolves inside the container.
