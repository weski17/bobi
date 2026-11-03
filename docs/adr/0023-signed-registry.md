# ADR-0023: Signed registry for skills and slash commands

- Status: Accepted (2026-11-03)
- Date: 2026-11-03

## Context

Teams want to share skills and slash commands. A public marketplace is deliberately off (code and data stay in the
company network), and a skill is an instruction to the model: a manipulated skill is a prompt-injection vector that the
user would trust by default. Sharing therefore needs to prove *who* published a package and that it is unchanged.

## Decision

- A package is one JSON file `<name>-<version>.bobipkg.json`: manifest (name, kind, version, sha256 of every file),
  the file contents (UTF-8 text) and an Ed25519 signature over the manifest. A registry is any folder of such files
  (file share, git checkout, artifact store) – no server to run.
- Each publisher has a key (`~/.bobi/keys/publisher-ed25519.pem`, mode 0600). Users trust publishers explicitly:
  `bobi registry trust <public-key.pem>` (`~/.bobi/publishers/<key-id>.pem`).
- `install` verifies structure, file hashes and signature and requires a trusted publisher. It refuses unsafe paths
  (absolute, `..`, hidden files, symlinks), more than 50 files / 256 KB per file / 1 MB per package, downgrades,
  a different publisher than the installed one, and overwriting files that did not come from a package (all overridable
  with `--force` except signature and trust). Files are staged and renamed; a ledger `registry/installed.json` records
  what was installed from whom.
- Supported kinds: `skill` (directory with `SKILL.md`) and `command` (one Markdown file). Installed into
  `~/.bobi/skills` / `~/.bobi/commands`, or the project's `.bobi` with `--project` (used only while the project is trusted).
- No new dependency (`node:crypto`).

## Not included

- **MCP servers and IDE extensions** run code. Distributing them needs a separate review (what runs, with which rights,
  in the sandbox) and probably reproducible builds; not part of this decision.
- Revocation lists, key rotation, expiry and a server index/search. Today: remove the publisher (`untrust`) and the
  package is no longer installable; already installed packages stay (check `bobi registry list`).

## Consequences

- A stolen publisher key allows signed malicious skills until users untrust it. The key file is protected by file mode
  only; keep it on a managed machine.
- Trusting a publisher means trusting their prompts: installed skills reach the model as instructions.
