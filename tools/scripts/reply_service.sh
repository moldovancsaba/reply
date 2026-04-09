#!/usr/bin/env bash
# LaunchAgent entry: run the {reply} Node hub from this repo (see tools/launchd/com.reply.hub.plist).
# Ops guide: docs/LOCAL_MACHINE_DEPLOYMENT.md (logs, .env, Ollama, iMessage chat.db, troubleshooting).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_DIR="${HOME}/Library/Logs/Reply"
HUB_LOG="${LOG_DIR}/hub.log"

mkdir -p "$LOG_DIR"
# README / menubar expect `tail -f /tmp/reply-hub.log` to work; mirror launchd’s log file.
ln -sf "$HUB_LOG" /tmp/reply-hub.log

cd "$REPO_ROOT/chat"
exec /usr/bin/env node server.js
