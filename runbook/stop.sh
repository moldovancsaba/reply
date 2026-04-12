#!/usr/bin/env bash
# Stop the launchd hub when the plist exists; best-effort cleanup if the service was never installed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/chat/.env"

PLIST="${HOME}/Library/LaunchAgents/com.reply.hub.plist"
if [[ -f "$PLIST" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
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

# Foreground dev fallback: kill Reply hub (node … server.js) on PORT..PORT+15
if command -v lsof >/dev/null 2>&1; then
  for delta in $(seq 0 15); do
    port=$((BASE_PORT + delta))
    for pid in $(lsof -ti ":${port}" 2>/dev/null || true); do
      args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
      if echo "$args" | grep -q "server\\.js"; then
        kill "$pid" 2>/dev/null || true
      fi
    done
  done
fi

echo "Reply hub stop attempted (launchd + node server.js on ports ${BASE_PORT}–$((BASE_PORT + 15)))."
