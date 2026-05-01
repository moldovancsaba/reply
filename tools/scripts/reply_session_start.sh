#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CHAT_DIR="${REPO_ROOT}/chat"
LOG_DIR="${HOME}/Library/Logs/reply"
HUB_LOG="${LOG_DIR}/hub.log"
MIRROR_DAEMON="${REPO_ROOT}/tools/scripts/imessage_mirror_daemon.sh"
MIRROR_DB="${HOME}/Library/Application Support/reply/apple-source-mirrors/imessage/chat.db"

mkdir -p "$LOG_DIR"
ln -sf "$HUB_LOG" /tmp/reply-hub.log
chmod +x "$MIRROR_DAEMON"
"$MIRROR_DAEMON" || true

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:${PATH:-}"
if [[ -r "${MIRROR_DB}" ]]; then
  export REPLY_IMESSAGE_DB_PATH="${MIRROR_DB}"
fi

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
  echo "reply_session_start.sh: Node.js not found." >&2
  exit 1
}

cd "$CHAT_DIR"
echo "{reply} hub starting in foreground session mode. Keep this process running while using the app."
exec "$NODE_BIN" server.js 2>&1 | tee -a "$HUB_LOG"
