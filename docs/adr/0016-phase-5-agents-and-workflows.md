# ADR-0016: Orchestrator, skills, slash commands, git, security mode, literate coding

- Status: Accepted (2026-10-19, phase 5 plan approved by the project owner)
- Date: 2026-10-19

## Decisions

- **Orchestrator (req. 10):** Bobi modes are engine agents with `mode: all` (primary and subagent); a mode with the
  `subtask` group (the orchestrator) stays primary-only to avoid delegation loops. The engine's `subagent` tool lists
  modes by description + `whenToUse`. Subtasks run in child sessions with their mode's rules; their approvals reach
  the user (TUI natively, IDE by tracking child sessions).
- **Skills and commands (req. 11):** `SKILL.md` in `$BOBI_HOME/skills/<name>/` and `.bobi/skills/<name>/`; commands as
  `*.md` with frontmatter (`description`, `mode`) and `$ARGUMENTS` in built-in `defaults/commands/`,
  `$BOBI_HOME/commands/`, `.bobi/commands/`. Project files only with trust and part of the trust fingerprint.
  The engine's built-in skills are disabled (one makes the model fetch the vendor's online docs).
- **Git (req. 15):** built-in `/commit` and `/pr`. Every git command asks. (Until 2026-11-19 the default policy allowed
  read-only `git status|diff|log|show` without asking; the security review of that day showed that a redirect such as
  `git log > file` writes files and a crafted git directory runs code through `core.fsmonitor`, so the rules were
  removed. An explicit shell auto-approval never covers a redirect into a file.) The IDE's Source Control button
  writes a commit message through a short Bobi session (diff read via the shell tool → masked and audited), not via a
  direct model call.
- **Security agent (req. 13):** built-in mode `security` (read, execute, edit) with a reviewer role; `/security-review`.
  Fixes are proposed as edits and approved one by one.
- **Literate coding (req. 12):** IDE command "Bobi: Implement Instructions Here" (`Cmd+Alt+Enter` / `Ctrl+Alt+Enter`,
  editor context menu): the selection or the comment block at the cursor becomes the instruction; the result arrives
  as an edit approval with the diff editor. Own key binding, not the one of comparable products.
- **Shell:** `bobi modes [--json]`, `bobi run --mode <slug>`; slash commands and skills work in the terminal UI.

## Not in this phase

- Code tips while typing (req. 14) – not in the phase 5 scope of CLAUDE.md.
- Distributable Bobi IDE app (decision 2026-10-19: run from source for now, ADR-0008).
