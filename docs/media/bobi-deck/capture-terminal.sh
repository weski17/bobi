#!/bin/bash
# Produces the real terminal output shown on the deck's slides, into terminal/*.txt.
# - dossier: runs on a COPY of the audit log of the local demo container (real agent turns); the container is not touched.
# - registry: runs in throw-away homes (publisher "alice", user "bob") with a tiny example command package.
# Needs: docker with the demo running (docs/DEPLOYMENT.md, "Ohne Server"), bun, and a checkout with `bun install` done.
#   REPO=/path/to/bobi-checkout bash capture-terminal.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${REPO:-/Users/waeleskeif/Documents/GitHub/bobi}"
CONTAINER="${DEMO_CONTAINER:-bobi-demo-demo-1}"
CLI="$REPO/packages/shell/src/cli.ts"
OUT="$HERE/terminal"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

# `run <home> <file> <args...>`: shows the command as a user would type it and appends the real output.
run() {
  local home="$1" file="$2"
  shift 2
  local shown="" arg
  for arg in "$@"; do
    case "$arg" in *" "*) shown="$shown \"$arg\"" ;; *) shown="$shown $arg" ;; esac
  done
  echo "\$ bobi$shown" >>"$OUT/$file"
  # The throw-away home directory is shown as ~/.bobi; nothing else is changed.
  (cd "$WORK/cwd" && BOBI_HOME="$home" bun "$CLI" "$@" 2>&1 | cut -c1-200 | sed "s#$WORK/[a-z-]*#~/.bobi#g") >>"$OUT/$file"
  echo >>"$OUT/$file"
}
mkdir -p "$WORK/cwd"

# --- dossier -------------------------------------------------------------------------------------------------------
rm -f "$OUT"/dossier-*.txt
DH="$WORK/dossier-home"
mkdir -p "$DH"
docker cp "$CONTAINER:/home/bun/.bobi/audit" "$DH/audit" >/dev/null
SESSION="$(grep 'bobi.task' "$DH"/audit/*.jsonl | grep 'checkout' | head -1 | grep -o 'ses_[A-Za-z0-9]*')"
echo "dossier session: $SESSION"
run "$DH" dossier-list.txt dossier --list
run "$DH" dossier-tasks.txt dossier --list --session "$SESSION"
run "$DH" dossier-seal.txt dossier --session "$SESSION" --task 1 --out task.json
run "$DH" dossier-verify.txt dossier verify task.json
sed 's/"task": 1/"task": 2/' "$WORK/cwd/task.json" >"$WORK/cwd/forged.json"
run "$DH" dossier-verify-forged.txt dossier verify forged.json

# --- registry ------------------------------------------------------------------------------------------------------
rm -f "$OUT"/registry-*.txt
AH="$WORK/alice"
BH="$WORK/bob"
mkdir -p "$AH" "$BH" "$WORK/cwd/reg"
printf 'Erkläre $ARGUMENTS in drei Sätzen.\n' >"$WORK/cwd/erklaere.md"
BOBI_HOME="$AH" bun "$CLI" registry key 2>/dev/null >"$WORK/cwd/alice.pem"
run "$AH" registry-pack.txt registry pack erklaere.md --version 1.0.0 --out reg
run "$BH" registry-trust.txt registry trust alice.pem
run "$BH" registry-install.txt registry install erklaere --from reg
run "$AH" registry-revoke.txt registry revoke erklaere --reason "enthält ein Token" --out reg
run "$BH" registry-refused.txt registry install erklaere --from reg --force
run "$BH" registry-check.txt registry check --from reg
run "$BH" registry-remove.txt registry check --from reg --remove
# --- code tips: Bobi checks its own registry code ------------------------------------------------------------------
rm -f "$OUT"/tips-*.txt
echo '$ bobi tips packages/core/src/registry.ts' >"$OUT/tips-self.txt"
(cd "$REPO" && bun "$CLI" tips packages/core/src/registry.ts 2>&1 | cut -c1-200) >>"$OUT/tips-self.txt"
echo "done: $(ls "$OUT" | wc -l) files in $OUT"
