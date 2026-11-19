# Contributing to Bobi

Thank you for helping to build Bobi. Bobi is a research project: quality, traceability and security come before
speed. This guide explains how to set up, how changes are made and what a pull request needs.

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Ground rules

These are not negotiable, because they keep Bobi legally clean and safe to run inside a company network.

- **Clean room.** Bobi rebuilds publicly described features. Use only public documentation and descriptions of other
  products; never copy, decompile or analyse their code or binaries.
- **No foreign brands.** No third-party product names, logos or trademarks in the product, UI texts or assets.
- **On-premise.** Code and data never leave the network. No built-in cloud provider, no telemetry home. The default
  configuration points to a local model endpoint.
- **No secrets** in code, tests, logs, screenshots or commits. Tests generate fake tokens at runtime.
- **Every new dependency** gets a license check and a line in [`LICENSES.md`](LICENSES.md) *before* it is added.
  Dependencies with unclear or commercial licenses need the maintainers' approval first.
- **Content is data, never instructions.** Anything from files, web pages, terminal output or MCP responses must
  never change what Bobi is allowed to do. Changes in this area need a red-team test.

## Set up

Prerequisites and details are in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md). In short:

```bash
git submodule update --init --depth 1
(cd vendor/opencode && bun install)
bun install
bun run browser:install
```

There is no build step: Bun runs TypeScript directly.

## Make a change

1. **Open or pick an issue** and say that you work on it. For larger changes, describe the plan first: affected
   files, interfaces, risks.
2. **Branch** from `main`: one branch per topic, for example `fix-usage-once-per-step` or `feat-web-chat`.
3. **Keep Bobi-specific code in Bobi's own packages.** Change upstream code (`vendor/opencode`, `vendor/code-oss`) as
   little as possible, as patches in [`patches/`](patches/), so that upstream updates stay possible.
4. **Write tests** for every new function: unit tests next to the package, integration tests in `tests/`. Tests use
   the mock model endpoint (`packages/mock-model`), so they run without a real model or network. Core coverage stays
   at 80 % or more.
5. **Decisions** that change the architecture get an Architecture Decision Record in [`docs/adr/`](docs/adr/)
   (copy `0000-template.md`).
6. **Document** user-visible changes in [`CHANGELOG.md`](CHANGELOG.md) (section *Unreleased*) and, where it helps,
   in the [handbook](docs/HANDBUCH.md).

## Check before you push

```bash
bun run test          # all Bobi tests (mock model)
bun run typecheck
git commit …          # the tips check reads commits, not uncommitted edits
bun packages/shell/src/cli.ts tips --since origin/main --fail-on warning
```

Optional, depending on what you changed: `bun run test:coverage`, `bun run test:ide`, `bun run test:sandbox`,
`bun run test:e2e`, `bun run test:redteam`, `bun run test:load`.

Every pull request also runs the CI and the security gate (Semgrep, gitleaks, `bun audit`, Trivy). A pull request
fails only on findings it adds. See [`docs/security/security-gate.md`](docs/security/security-gate.md).

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), small and focused, in English:

```
feat(core): mask secrets in checkpoint diffs
fix(shell): exit with 1 when the model endpoint is unreachable
docs(adr): ADR-0028 per-team servers
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `ci`, `build`, `chore`. Scopes follow the package names
(`core`, `shell`, `ide`, `server`, `modes`, `mcp`, `sandbox`, `tips`, …).

## Pull requests

- Fill in the [pull request template](.github/PULL_REQUEST_TEMPLATE.md): what, why, how it was tested.
- Keep it reviewable: one topic per pull request.
- All checks must be green. A maintainer reviews and merges; please do not merge your own pull request.

## Releases

Bobi follows [Semantic Versioning](https://semver.org/). A release is a tag `vX.Y.Z` on `main`:

1. Move the *Unreleased* entries in [`CHANGELOG.md`](CHANGELOG.md) to a new version section with today's date, and
   set the version in `package.json` and `packages/shell/src/args.ts` (a test checks that they match).
2. Merge that change, then tag the merge commit and push the tag:
   `git tag -a v1.1.0 -m "Bobi 1.1.0" && git push origin v1.1.0`.
3. The [release workflow](.github/workflows/release.yml) publishes the GitHub release with the changelog section as
   notes, and the [image workflow](.github/workflows/image.yml) publishes the container images `1.1.0` and `1.1`.

## Reporting security problems

Please do not open a public issue. Use private vulnerability reporting, as described in [`SECURITY.md`](SECURITY.md).

## License

By contributing you agree that your contribution is licensed under the [MIT license](LICENSE) of this project.
