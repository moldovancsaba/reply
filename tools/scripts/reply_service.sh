#!/usr/bin/env bash
# LaunchAgent entry: run the {reply} Node hub from this repo (see tools/launchd/com.reply.hub.plist).
# Ops guide: docs/LOCAL_MACHINE_DEPLOYMENT.md (logs, .env, Ollama, iMessage chat.db, troubleshooting).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="${HOME}/Library/Logs/reply"
HUB_LOG="${LOG_DIR}/hub.log"

mkdir -p "$LOG_DIR"
# Mirror launchd’s log file to a stable temp path for quick inspection.
ln -sf "$HUB_LOG" /tmp/reply-hub.log

# launchd sets PATH in com.reply.hub.plist; still resolve Node explicitly for nvm-free reliability.
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${PATH:-}"

resolve_node() {
  if [[ -n "${REPLY_NODE_BIN:-}" && -x "${REPLY_NODE_BIN}" ]]; then
    printf '%s\n' "$REPLY_NODE_BIN"
    return 0
  fi
  local found
  found="$(command -v node 2>/dev/null || true)"
  if [[ -n "$found" && -x "$found" ]]; then
    printf '%s\n' "$found"
    return 0
  fi
  for candidate in /opt/homebrew/bin/node /usr/local/bin/node; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

NODE_BIN="$(resolve_node)" || {
  echo "reply_service.sh: Node.js not found. Install Node (e.g. Homebrew) or set REPLY_NODE_BIN in ~/Library/LaunchAgents/com.reply.hub.plist EnvironmentVariables." >&2
  exit 1
}

cd "$REPO_ROOT/chat"
exec "$NODE_BIN" server.js
