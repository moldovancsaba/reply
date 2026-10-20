#!/usr/bin/env bash
# Unload and remove deprecated com.reply.worker LaunchAgent (conflicts with hub-managed worker).
# Supported setup: only com.reply.hub via `make run`. See docs/LOCAL_MACHINE_DEPLOYMENT.md.
set -euo pipefail

PLIST="${HOME}/Library/LaunchAgents/com.reply.worker.plist"
LABEL="gui/$(id -u)/com.reply.worker"

if [[ ! -f "$PLIST" ]]; then
  echo "No legacy ${PLIST} — nothing to do."
  exit 0
fi

launchctl bootout "$LABEL" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
echo "Removed legacy LaunchAgent: com.reply.worker (plist deleted). Run: make run"
