#!/usr/bin/env bash
# Runs the Bobi server in a Podman sandbox (ADR-0007):
#   - bobi-server: unprivileged, only on the internal network, project mounted at the same path
#   - bobi-egress: the only way out; allows only the hosts in BOBI_EGRESS_ALLOW
# Usage: sandbox/bobi-sandbox.sh up <project-dir> | down | status
set -euo pipefail

IMAGE="${BOBI_IMAGE:-localhost/bobi:dev}"
NET="bobi-internal"
PORT="${BOBI_SANDBOX_PORT:-4096}"
# Model gateway on the host as seen from the containers (LiteLLM default port).
DEFAULT_ALLOW="host.containers.internal:4000"

up() {
  local project
  project="$(cd "${1:?project directory required}" && pwd -P)"
  : "${BOBI_SERVER_PASSWORD:?set BOBI_SERVER_PASSWORD (at least 16 characters)}"
  local model_url="${BOBI_MODEL_BASE_URL:-http://host.containers.internal:4000/v1}"

  podman network exists "$NET" || podman network create --internal "$NET" >/dev/null
  podman volume exists bobi-home || podman volume create bobi-home >/dev/null
  # Hidden checkpoint repositories of non-git projects (.git pointer files) live on the host; mount them at
  # the same path so the pointers resolve inside the container too.
  local shadow="${BOBI_HOME:-$HOME/.bobi}/data/shadow"
  mkdir -p "$shadow"
  # Project trust decisions made on the host (bobi attach asks), read-only for the server.
  local trust="${BOBI_HOME:-$HOME/.bobi}/trust"
  mkdir -p "$trust"
  # Files excluded by .bobiignore are hidden inside the container: empty read-only overlays, so even
  # arbitrary shell commands cannot read them.
  local masks=()
  # Ignored directories are covered with an empty directory (a bind mount, so it is applied after the project
  # mount; a tmpfs would be mounted first and end up hidden under the project).
  local empty="${BOBI_HOME:-$HOME/.bobi}/sandbox/empty"
  mkdir -p "$empty"
  local repo
  repo="$(cd "$(dirname "$0")/.." && pwd)"
  while IFS= read -r ignored; do
    [ -z "$ignored" ] && continue
    case "$ignored" in *,*) echo "warning: cannot hide path with a comma: $ignored" >&2; continue ;; esac
    if [ "${ignored%/}" != "$ignored" ]; then
      masks+=(--mount "type=bind,source=${empty},destination=${ignored%/},ro=true")
    else
      masks+=(--mount "type=bind,source=/dev/null,destination=${ignored},ro=true")
    fi
  done < <(bun "$repo/scripts/bobiignore-paths.ts" "$project")

  podman rm -f bobi-egress bobi-server >/dev/null 2>&1 || true
  podman run -d --name bobi-egress --network podman --network "$NET" \
    --read-only --cap-drop all --security-opt no-new-privileges \
    -e BOBI_EGRESS_ALLOW="${BOBI_EGRESS_ALLOW:-$DEFAULT_ALLOW}" \
    --entrypoint bun "$IMAGE" /opt/bobi/packages/egress-proxy/src/cli.ts >/dev/null

  # Bind-mount roots can appear as owned by root inside the VM; git then refuses the repository. Only the
  # mounted project and its checkpoint directory are declared safe (not "*").
  podman run -d --name bobi-server --network "$NET" -p "127.0.0.1:${PORT}:4096" \
    --cap-drop all --security-opt no-new-privileges --pids-limit 512 --memory 4g \
    -v "${project}:${project}" -v "${shadow}:${shadow}" -v bobi-home:/home/bun/.bobi \
    -v "${trust}:/home/bun/.bobi/trust:ro" ${masks[@]+"${masks[@]}"} -w "$project" \
    -e HTTP_PROXY=http://bobi-egress:3128 -e HTTPS_PROXY=http://bobi-egress:3128 \
    -e http_proxy=http://bobi-egress:3128 -e https_proxy=http://bobi-egress:3128 \
    -e NO_PROXY=localhost,127.0.0.1 -e no_proxy=localhost,127.0.0.1 \
    -e BOBI_SERVER_PASSWORD -e BOBI_MODEL_BASE_URL="$model_url" -e BOBI_MODEL -e BOBI_MODEL_API_KEY \
    -e BOBI_USER="${BOBI_USER:-$USER}" -e OTEL_EXPORTER_OTLP_ENDPOINT -e BOBI_A2A \
    -e GIT_CONFIG_COUNT=2 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0="$project" \
    -e GIT_CONFIG_KEY_1=safe.directory -e GIT_CONFIG_VALUE_1="$shadow" \
    -e ZOWE_OPT_HOST -e ZOWE_OPT_PORT -e ZOWE_OPT_PROTOCOL -e ZOWE_OPT_USER -e ZOWE_OPT_PASSWORD \
    -e ZOWE_OPT_BASE_PATH -e ZOWE_OPT_REJECT_UNAUTHORIZED -e BOBI_ZOWE_PROFILE -e BOBI_ZOWE_DATASETS -e BOBI_ZOWE_USS \
    "$IMAGE" >/dev/null

  for _ in $(seq 1 60); do
    if curl -sf -o /dev/null -u "opencode:${BOBI_SERVER_PASSWORD}" "http://127.0.0.1:${PORT}/api/session"; then
      echo "Bobi sandbox ready: http://127.0.0.1:${PORT}"
      echo "Connect: cd ${project} && bun $(cd "$(dirname "$0")/.." && pwd)/packages/shell/src/cli.ts attach http://127.0.0.1:${PORT}"
      return 0
    fi
    sleep 1
  done
  echo "Bobi server did not become ready; logs:" >&2
  podman logs bobi-server >&2 || true
  return 1
}

down() {
  podman rm -f bobi-server bobi-egress >/dev/null 2>&1 || true
  echo "Bobi sandbox stopped"
}

status() {
  podman ps -a --filter name=bobi- --format '{{.Names}}\t{{.Status}}'
  echo "--- egress decisions (last 20)"
  podman logs --tail 20 bobi-egress 2>/dev/null || true
}

case "${1:-}" in
  up) shift; up "$@" ;;
  down) down ;;
  status) status ;;
  *) echo "usage: $0 up <project-dir> | down | status" >&2; exit 2 ;;
esac
