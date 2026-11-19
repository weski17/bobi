## What and why

<!-- What does this change, and which problem does it solve? Link the issue: Closes #… -->

## How it was tested

<!-- Commands you ran and their result. Tests run against the mock model; say so if you also used a real model. -->

- [ ] `bun run test`
- [ ] `bun run typecheck`
- [ ] `bun packages/shell/src/cli.ts tips --since origin/main --fail-on warning` (after committing)
- [ ] Other (IDE, sandbox, e2e, red team): …

## Checklist

- [ ] Conventional Commit messages (`feat(core): …`), small and focused
- [ ] New or changed behaviour has unit or integration tests
- [ ] New dependency: license checked and listed in [`LICENSES.md`](../LICENSES.md) (or: no new dependency)
- [ ] Architecture change: ADR in [`docs/adr/`](../docs/adr/) (or: none)
- [ ] User-visible change: [`CHANGELOG.md`](../CHANGELOG.md) and docs updated
- [ ] No secrets, customer code or production data in code, tests, logs or screenshots
