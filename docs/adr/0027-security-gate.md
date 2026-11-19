# ADR-0027: Security gate for pull requests and pushes

- Status: Proposed (2026-11-10)
- Date: 2026-11-10

## Context

Every pull request and every push (a merge is a push to `main`) should be scanned for vulnerabilities, and a pull request
with a finding should not be merged. Bobi has a security mode, but with the small local models we tested it reported
wrong findings at times (wrong function, invented problem). A gate that blocks or lets through by chance is a risk in both
directions. Also, the model is inside the company network; GitHub's runners cannot reach it.

## Decision

- **Deterministic scanners decide.** `.github/workflows/security.yml` runs on every pull request, every push to any branch
  and on demand:
  - Semgrep (TypeScript and secrets rules, as before; the job moved here from `ci.yml`),
  - gitleaks (secrets in the new commits; `.gitleaks.toml` lists test files with fake secrets, file by file),
  - `bun audit` (known vulnerabilities in dependencies, high and above),
  - Trivy in file system mode (misconfigurations in Containerfiles, compose files and workflows; dependencies in the
    lockfiles it can read; it cannot read `bun.lock` yet, which is why `bun audit` stays).
- **Only what a change adds counts.** In a pull request, Semgrep compares with the merge base and gitleaks scans only the
  pull request's commits; on a push, gitleaks scans the pushed commits. Existing findings do not block, the same rule as
  the code-tips check.
- **One required check.** The job `security-gate` is green only if all scanners are. A branch rule on `main` requires it
  and requires pull requests; that is what stops a direct push, because a workflow always runs after the push.
- **The agent advises.** The job `security-agent` runs `bobi run --mode security-ci` on the changed files and posts (and
  later updates) one comment with findings, severity and a fix. It never fails, is not part of the gate and runs only when
  the repository variable `BOBI_SECURITY_AGENT` is `true`, on a self-hosted runner with the labels `self-hosted, bobi-model`.
- **A new built-in mode `security-ci`** with only the read group: no shell, no edits. It is built in, so the code under
  review cannot change it. The answer format is a fixed JSON block; the comment is built from parsed fields only
  (`packages/core/src/security-review.ts`): masked, escaped (no HTML, links or mentions), limited in size. Findings for
  files outside the change are dropped. An answer without a valid block is reported as unreadable, never as clean.
- **Isolation of the reviewer.** Only pull requests from this repository (no forks). Bobi is checked out from the base
  commit, the change into a second folder; the reviewed project is not trusted, so its `AGENTS.md`, rules, modes and
  config are ignored. No credentials are kept in the checkouts.

## Not included

- The agent blocking a merge. Possible later with a strong model and measured precision; then as its own required check.
- Automatic fix pull requests from the agent (needs write rights and an auto-approval; separate decision).
- Semgrep rule sets beyond the current ones (for example OWASP Top 10): some registry rules are under the Semgrep Rules
  License, which is not an open-source licence. Needs a licence check first.
- Setting up the branch rule. It is a repository setting; the owner sets it (command in `docs/security/security-gate.md`).

## Consequences

- A pull request also runs the push scan of its branch; the duplicate costs a few minutes of CI, not correctness.
- New built-in mode in mode lists (`bobi modes`, the IDE). Projects can override it like any built-in mode, but only in
  trusted projects; the workflow never trusts the reviewed project.
- New CI tools: gitleaks (MIT), Trivy fs (already used for images, Apache-2.0).
