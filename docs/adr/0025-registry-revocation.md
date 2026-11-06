# ADR-0025: Revocation list for the signed registry

- Status: Accepted (2026-11-06)
- Date: 2026-11-06

## Context

ADR-0023 left revocation out: the only answer to a bad package was `untrust` for the whole publisher, which does
not help when one package of an otherwise good publisher is wrong (a leaked token in a skill, a prompt that turned out
harmful), and it does nothing about packages that are already installed.

## Decision

- A **revocation list** is one JSON file `revocations.bobirev.json` in the registry folder, signed (Ed25519) by a
  trusted publisher. Entries select what is revoked: `name`, `version` (needs `name`), `keyId` (everything signed with
  that key) and/or `manifestHash` (exactly one package build); every given selector must match. Each entry has a reason
  (≤ 400 characters) and a date.
- The list has a **serial** that grows with every new list of the same signer, and it is the signer's *complete*
  state: a newer list replaces the older entries of that signer (this is how an entry is withdrawn).
- Bobi keeps the verified entries in `~/.bobi/registry/revocations.json`, with the highest serial seen per signer. A
  list with a **lower serial is refused** (rollback), so putting an old file back does not un-revoke anything.
- The list is taken over on `bobi registry install --from <folder>` and `bobi registry check --from <folder>`. A list
  that does not verify (bad signature, signer not trusted, rollback) is an **error, not ignored**: an install must not
  go ahead as if nothing were revoked. A damaged local store is an error too.
- **Install refuses a revoked package, also with `--force`.** `--force` stays limited to the cases of ADR-0023.
- `bobi registry check [--project] [--remove]` lists installed packages that a revocation matches (exit 1 while any
  remain); `--remove` deletes exactly those files and their ledger entries. The ledger now records the manifest hash of
  what was installed (older records cannot be matched by hash, only by name, version and key).
- `bobi registry revoke [<name>] [--version V] [--key-id ID] [--hash H] --reason T [--out DIR]` signs and extends the
  list in `DIR`. Only the signer of an existing list can extend it. `bobi registry verify` prints the manifest hash.
- Any trusted publisher may revoke anything. Revoking only removes trust, so the worst case is a nuisance, and a
  trusted publisher can do harm in other ways anyway (ADR-0023).
- No new dependency (`node:crypto`).

## Not included

- **Automatic checking.** Nothing polls a registry: a revocation takes effect when a user runs `install` or `check`
  against the folder. Someone who never does that never learns about it. Running `bobi registry check --from <folder>`
  in a scheduled job or at start-up is possible but not part of this decision.
- **Freshness.** A registry folder that simply never gets a new list (or whose list file is deleted) cannot be told
  apart from "nothing revoked"; the serial only protects against old files after a newer one was seen.
- Key rotation, expiry of publisher trust and a revocation of the *revocation* signer's key (use `untrust`).

## Consequences

- A stolen publisher key can sign revocations as well, but only for what that key could do anyway.
- Installed skills and commands that are revoked stay active until the user runs `check --remove`; `check` makes this
  visible but does not enforce it at run time.
