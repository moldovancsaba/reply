#!/usr/bin/env bash
# Quick operational snapshot for `make status` and the Reply menubar app.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/chat/.env"

UID_NUM="$(id -u)"
LABEL="gui/${UID_NUM}/com.reply.hub"

echo "=== launchd: ${LABEL} ==="
if launchctl print "$LABEL" >/dev/null 2>&1; then
  launchctl print "$LABEL" 2>/dev/null | head -40 || true
else
  echo "(not loaded — run: make run from the repo root)"
fi

BASE_PORT="45311"
if [[ -f "$ENV_FILE" ]]; then
  line="$(grep -E '^[[:space:]]*PORT[[:space:]]*=' "$ENV_FILE" | tail -1 || true)"
  if [[ -n "${line}" ]]; then
    val="${line#*=}"
    val="${val// /}"
    val="${val//\"/}"
    val="${val//\'/}"
    if [[ -n "${val}" ]] && [[ "${val}" =~ ^[0-9]+$ ]]; then
      BASE_PORT="${val}"
    fi
  fi
fi

# After launchctl load the hub may need a second or two before bind (avoid false "unreachable").
HEALTH_PORT=""
for _attempt in 1 2 3 4 5 6; do
  for delta in $(seq 0 15); do
    p=$((BASE_PORT + delta))
    if curl -sfS --max-time 2 "http://127.0.0.1:${p}/api/health" >/dev/null 2>&1; then
      HEALTH_PORT="$p"
      break 2
    fi
  done
  sleep 1
done

echo ""
if [[ -n "$HEALTH_PORT" ]]; then
  echo "=== http://127.0.0.1:${HEALTH_PORT}/api/health ==="
  curl -sfS --max-time 3 "http://127.0.0.1:${HEALTH_PORT}/api/health" || true
  echo ""
else
  echo "=== http://127.0.0.1:${BASE_PORT}–$((BASE_PORT + 15))/api/health ==="
  echo "(unreachable — check PORT in chat/.env and hub.log)"
fi

echo ""
echo "=== hub.log (last 25 lines) ==="
HUB_LOG="${HOME}/Library/Logs/Reply/hub.log"
if [[ -f "$HUB_LOG" ]]; then
  tail -25 "$HUB_LOG"
else
  echo "(no ${HUB_LOG} yet)"
fi
