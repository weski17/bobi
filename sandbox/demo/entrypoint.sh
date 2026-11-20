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
# BOBI_HOME is a volume that outlives restarts and is shared by all visitors. Everything in it that steers Bobi
# (global rules, modes, skills, commands, registry, trust decisions) is removed at every start, so nothing a visitor
# planted reaches later visitors; audit and usage data stay (security review 2026-11-19, M7).
find "$BOBI_HOME" -mindepth 1 -maxdepth 1 \( -name rules -o -name 'rules-*' -o -name custom_modes.yaml -o -name skills \
  -o -name commands -o -name registry -o -name trust -o -name AGENTS.md \) -exec rm -rf {} +
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
# A2A needs its own token (the demo only shows the public agent card). It is given to the server alone, not exported,
# so visitor shells do not inherit it.
BOBI_A2A=1 BOBI_A2A_TOKEN="$(head -c 32 /dev/urandom | base64 | tr -d '/+=\n')" \
  bun /opt/bobi/packages/shell/src/cli.ts serve --hostname 127.0.0.1 --port 4096 > /tmp/bobi-server.log 2>&1 &
pids+=($!)
# The credential goes to curl on stdin, not on its command line (visible to every process in the container).
for _ in $(seq 1 60); do printf 'user = "opencode:%s"\n' "$BOBI_SERVER_PASSWORD" | curl -fsS -o /dev/null -K - http://127.0.0.1:4096/api/session 2> /dev/null && break; sleep 1; done

ttyd_args=(ttyd -d 3 -W -O -p 7681 -m 8 -c "demo:${DEMO_PASSWORD}" -t titleFixed="Bobi Demo" -t fontSize=15 -t 'theme={"background":"#0a0f1e"}')
if [ -f /run/tls/tls.crt ] && [ -f /run/tls/tls.key ]; then
  ttyd_args+=(--ssl --ssl-cert /run/tls/tls.crt --ssl-key /run/tls/tls.key)
  echo "Bobi demo: web terminal with TLS on :7681"
else
  echo "Bobi demo: web terminal on :7681 (plain HTTP – put a TLS reverse proxy in front outside a trusted network)"
fi
"${ttyd_args[@]}" /opt/demo/session.sh &
pids+=($!)

# Shared workspace of the web chat and the optional web IDE: a git copy of the sample project, trusted up front.
ws=/home/bun/ide/workspace
if [ ! -d "$ws/.git" ]; then
  mkdir -p "$ws" && cp -a /opt/demo/workspace/. "$ws"/
  git -C "$ws" init -q -b main && git -C "$ws" add -A && git -C "$ws" -c user.name=demo -c user.email=demo@localhost commit -qm "Sample project"
fi
bobi trust --yes "$ws" > /dev/null 2>&1 || echo "Bobi demo: could not pre-trust the sample project" >&2

# Web chat (ADR-0024): the chat panel of the IDE as a plain web page, so nothing but a browser is needed. The gate on
# :7682 serves it behind the same login as the terminal and forwards only the calls the chat needs to the Bobi server.
echo "Bobi demo: starting the web chat …"
WEBCHAT_DIRECTORY="$ws" bun /opt/bobi/packages/web-chat/src/cli.ts &
pids+=($!)

# Web IDE with the Bobi chat panel (only in images that contain it, see ADR-0021). It runs on 127.0.0.1; the password
# gate on :7683 is the only way in. All visitors share the workspace folder.
if [ -x /opt/bobi-ide/node ]; then
  # Machine settings of the demo IDE: dark theme, no telemetry or updates, the engine's own (empty) chat side bar hidden –
  # Bobi's chat panel is the one to try.
  mkdir -p /home/bun/ide/server-data/data/Machine
  cat > /home/bun/ide/server-data/data/Machine/settings.json <<'JSON'
{
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.startupEditor": "none",
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "chat.disableAIFeatures": true,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoUpdate": false,
  "extensions.autoCheckUpdates": false
}
JSON
  echo "Bobi demo: starting the web IDE …"
  /opt/bobi-ide/node /opt/bobi-ide/out/server-main.js --host 127.0.0.1 --port 8080 --without-connection-token \
    --accept-server-license-terms --server-data-dir /home/bun/ide/server-data --default-folder "$ws" > /tmp/bobi-ide.log 2>&1 &
  pids+=($!)
  # Password gate: nginx with HTTP Basic auth (user demo, the same password as the terminal), WebSocket support and an
  # Origin check against cross-site WebSocket hijacking. Everything it writes goes to /tmp.
  mkdir -p /tmp/nginx
  perl -e 'my $s = join "", map { ("a".."z", "A".."Z", 0..9)[rand 62] } 1..12; print "demo:" . crypt($ARGV[0], "\$6\$$s\$") . "\n"' "$DEMO_PASSWORD" > /tmp/nginx/htpasswd
  listen="7683"; tls=""
  if [ -f /run/tls/tls.crt ] && [ -f /run/tls/tls.key ]; then listen="7683 ssl"; tls="ssl_certificate /run/tls/tls.crt; ssl_certificate_key /run/tls/tls.key;"; fi
  cat > /tmp/nginx/nginx.conf <<NGINX
daemon off;
pid /tmp/nginx/nginx.pid;
error_log /dev/stderr warn;
events { worker_connections 256; }
http {
  access_log off;
  server_tokens off;
  client_body_temp_path /tmp/nginx/body;
  proxy_temp_path /tmp/nginx/proxy;
  fastcgi_temp_path /tmp/nginx/fastcgi;
  uwsgi_temp_path /tmp/nginx/uwsgi;
  scgi_temp_path /tmp/nginx/scgi;
  map \$http_upgrade \$connection_upgrade { default upgrade; '' close; }
  map "\$http_origin|\$http_host" \$origin_ok { default 0; "~^\\|" 1; "~^https?://(?<h>[^|]+)\\|\\k<h>\$" 1; }
  server {
    listen $listen;
    $tls
    auth_basic "Bobi Demo";
    auth_basic_user_file /tmp/nginx/htpasswd;
    if (\$origin_ok = 0) { return 403; }
    location / {
      proxy_pass http://127.0.0.1:8080;
      proxy_http_version 1.1;
      proxy_set_header Upgrade \$http_upgrade;
      proxy_set_header Connection \$connection_upgrade;
      proxy_set_header Host \$http_host;
      proxy_set_header Authorization "";
      # The IDE's files are addressed by the upstream commit, which does not change when this image is rebuilt: let
      # browsers re-check them, otherwise visitors keep an old version after an update.
      proxy_hide_header Cache-Control;
      add_header Cache-Control "no-cache" always;
      proxy_read_timeout 1d;
      proxy_send_timeout 1d;
    }
  }
}
NGINX
  nginx -e /dev/stderr -c /tmp/nginx/nginx.conf &
  pids+=($!)
fi

# If one of the three services stops, stop all, so the container restarts cleanly. Only these pids are awaited:
# the short model warm-up job above ends on purpose and must not count.
wait -n "${pids[@]}" || true
echo "Bobi demo: a component stopped – shutting down" >&2
cleanup
exit 1
