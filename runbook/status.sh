#!/usr/bin/env bash
# Quick operational snapshot for `make status` and the Reply menubar app.
set -euo pipefail

UID_NUM="$(id -u)"
LABEL="gui/${UID_NUM}/com.reply.hub"

echo "=== launchd: ${LABEL} ==="
if launchctl print "$LABEL" >/dev/null 2>&1; then
  launchctl print "$LABEL" 2>/dev/null | head -40 || true
else
  echo "(not loaded — run: make run from the repo root)"
fi

echo ""
echo "=== http://127.0.0.1:45311/api/health ==="
if curl -sfS --max-time 3 "http://127.0.0.1:45311/api/health" 2>/dev/null; then
  echo ""
else
  echo "(unreachable)"
fi

echo ""
echo "=== hub.log (last 25 lines) ==="
HUB_LOG="${HOME}/Library/Logs/Reply/hub.log"
if [[ -f "$HUB_LOG" ]]; then
  tail -25 "$HUB_LOG"
else
  echo "(no ${HUB_LOG} yet)"
fi
