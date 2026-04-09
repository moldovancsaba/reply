#!/usr/bin/env bash
# Stop the launchd hub when the plist exists; best-effort cleanup if the service was never installed.
set -euo pipefail

PLIST="${HOME}/Library/LaunchAgents/com.reply.hub.plist"
if [[ -f "$PLIST" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
fi

# Foreground dev fallback: nothing listening after unload is OK.
if command -v lsof >/dev/null 2>&1; then
  for pid in $(lsof -ti :45311 2>/dev/null || true); do
    if ps -p "$pid" -o comm= 2>/dev/null | grep -q node; then
      kill "$pid" 2>/dev/null || true
    fi
  done
fi

echo "Reply hub stop attempted (launchd + port 45311 node cleanup)."
