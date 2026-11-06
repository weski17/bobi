# Demo – Phase 8: provable AI work, web chat

Beyond the 20 requirements: what makes Bobi's work checkable. Mock model or a real gateway as in the earlier demos.

## 1. Web chat (nothing to install)

```bash
export DEMO_PASSWORD="$(openssl rand -base64 18)"
docker compose -f compose.demo.yaml up -d        # → http://127.0.0.1:7682 (user: demo)
```

Choose a mode, ask something, watch the answer stream. For an edit the approval card shows the diff; *Accept* applies it,
*Undo* takes it back.

## 2. Change dossier

After a task in any surface:

```bash
bobi dossier --list                                            # sessions in the audit log (with their number of tasks)
bobi dossier --list --session <id>                             # the tasks (prompts) of one session
bobi dossier --task last --out task.json                       # seal only the latest task (or --task 2)
bobi dossier --out change.json --diff --test "bun test"        # seal the latest session with the diff and a test run
bobi dossier verify change.json                                # intact: N events, key …
```

Now change one character in `change.json` (for example a prompt or a result) and run `verify` again:
`BROKEN: event N was changed`. Give a colleague the public key (`publicKey` in the file) and let them pin it:
`bobi dossier verify change.json --key colleague.pub.pem`.

A task dossier carries its task number inside the signature: change `"task": 1` to `2` in `task.json` and `verify`
says `BROKEN: the signature does not match`. (`--diff` is still the project's current uncommitted state, not only that
task's changes.)

## 3. Model comparison

In a git repository (every model starts from `HEAD` in its own worktree; the model ids must be served by your endpoint):

```bash
bobi compare --models large,small --test "bun test" --out compare.json "Fix the rounding bug in src/checkout.ts"
```

A table shows per model: run completed, tests passed, time, files, +/- lines, tool calls, tokens. Diffs are in `compare.json`.
Your working tree is untouched.

## 4. Signed registry

```bash
bobi registry key > anna.pub.pem                                 # publisher: share the public key
bobi registry pack skills/review-style --version 1.0.0 --out registry/
bobi registry trust anna.pub.pem                                 # user: trust the publisher once
bobi registry install review-style --from registry/              # verified, then installed
bobi registry list
```

Edit a file inside `registry/review-style-1.0.0.bobipkg.json` and install again: refused (`file … was changed`).

Revoke a package (the publisher) and see it refused and found on the user's side:

```bash
bobi registry revoke review-style --reason "contains a token" --out registry/   # signs registry/revocations.bobirev.json
bobi registry install review-style --from registry/ --force                      # refused: is revoked – also with --force
bobi registry check --from registry/                                             # lists installed packages that are revoked (exit 1)
bobi registry check --from registry/ --remove                                    # removes exactly those
```

Put an older `revocations.bobirev.json` back: refused (`rollback`), nothing is un-revoked.

## 5. Tips as a pull request check

```bash
bobi tips --since origin/main --fail-on warning                  # only what your change adds
```

In this repository it runs as the CI job `tips` on every pull request.

## 6. Tests

```bash
bun run test          # incl. dossier, compare, registry, web chat gate, tips ratchet
BOBI_DEMO_IMAGE=bobi-demo:local bun test ./tests/sandbox/demo.test.ts   # demo image incl. the web chat
```
