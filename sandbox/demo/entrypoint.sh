#!/usr/bin/env bash
# Starts the Bobi demo: the model (Ollama, local only), the Bobi server (local only) and the web terminal (the only
# port that is exposed). The container needs no internet: the model is part of the image.
set -euo pipefail

if [ "${#DEMO_PASSWORD}" -lt 12 ]; then
  echo "Bobi demo: set DEMO_PASSWORD (at least 12 characters) – it protects the web terminal." >&2
  exit 2
fi

# Ollama ignores the key, but the OpenAI-compatible client wants one (a placeholder, not a secret).
export BOBI_MODEL_API_KEY="${BOBI_MODEL_API_KEY:-ollama}"

# The server password is internal (sessions inherit it); visitors never need to know it.
export BOBI_SERVER_PASSWORD
BOBI_SERVER_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '/+=\n')"
mkdir -p "$BOBI_HOME"
cp /opt/demo/config.jsonc "$BOBI_HOME/config.jsonc"

pids=()
cleanup() { kill "${pids[@]}" 2>/dev/null || true; }
trap 'cleanup; exit 143' TERM INT

echo "Bobi demo: starting the model server (Ollama) …"
ollama serve > /tmp/ollama.log 2>&1 &
pids+=($!)
for _ in $(seq 1 60); do curl -fsS http://127.0.0.1:11434/api/version > /dev/null 2>&1 && break; sleep 1; done

# Load the model into memory in the background (first start: some seconds to minutes); `keep_alive: -1` keeps it there.
( curl -fsS http://127.0.0.1:11434/api/generate -d "{\"model\":\"$BOBI_MODEL\",\"prompt\":\"\",\"keep_alive\":-1}" > /dev/null 2>&1 || true ) &

echo "Bobi demo: starting the Bobi server …"
bun /opt/bobi/packages/shell/src/cli.ts serve --hostname 127.0.0.1 --port 4096 > /tmp/bobi-server.log 2>&1 &
pids+=($!)
for _ in $(seq 1 60); do curl -fsS -o /dev/null -u "opencode:$BOBI_SERVER_PASSWORD" http://127.0.0.1:4096/api/session 2> /dev/null && break; sleep 1; done

ttyd_args=(ttyd -W -O -p 7681 -m 8 -c "demo:${DEMO_PASSWORD}" -t titleFixed="Bobi Demo" -t fontSize=15 -t 'theme={"background":"#0a0f1e"}')
if [ -f /run/tls/tls.crt ] && [ -f /run/tls/tls.key ]; then
  ttyd_args+=(--ssl --ssl-cert /run/tls/tls.crt --ssl-key /run/tls/tls.key)
  echo "Bobi demo: web terminal with TLS on :7681"
else
  echo "Bobi demo: web terminal on :7681 (plain HTTP – put a TLS reverse proxy in front outside a trusted network)"
fi
"${ttyd_args[@]}" /opt/demo/session.sh &
pids+=($!)

# If one of the three services stops, stop all, so the container restarts cleanly. Only these pids are awaited:
# the short model warm-up job above ends on purpose and must not count.
wait -n "${pids[@]}" || true
echo "Bobi demo: a component stopped – shutting down" >&2
cleanup
exit 1
