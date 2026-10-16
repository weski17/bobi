#!/usr/bin/env bash
# Starts a Claude Code session in the Bobi repository and continues the current phase.
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code CLI not found. Install: https://docs.claude.com/claude-code" >&2
  exit 1
fi

phase="$(grep -oE 'Aktuelle Phase: [0-9]+' CLAUDE.md | grep -oE '[0-9]+' || echo 0)"
branch="$(git branch --show-current 2>/dev/null || echo '?')"

echo "Bobi – Phase ${phase} (Branch: ${branch})"

exec claude "Lies CLAUDE.md und docs/STATUS.md vollständig. Wir sind in Phase ${phase}. \
Fasse kurz den Stand zusammen und schlage die nächsten Schritte vor. \
Arbeite nur an Phase ${phase} und warte auf meine Freigabe, bevor du Code schreibst."
