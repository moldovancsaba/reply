#!/usr/bin/env bash
# Compare installed LaunchAgent paths to this repo (detect stale plist after moving the clone).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PLIST="${HOME}/Library/LaunchAgents/com.reply.hub.plist"

echo "=== {reply} doctor (repo vs LaunchAgent) ==="
echo "Current directory (expected repo root): ${REPO_ROOT}"

if [[ ! -f "$PLIST" ]]; then
  echo "No ${PLIST} — install with: make run"
  exit 0
fi

SCRIPT_IN_PLIST="$(python3 -c "
import plistlib
from pathlib import Path
p = Path.home() / 'Library/LaunchAgents/com.reply.hub.plist'
with p.open('rb') as f:
    d = plistlib.load(f)
args = d.get('ProgramArguments') or []
if len(args) >= 2:
    print(args[1])
")"

if [[ -z "$SCRIPT_IN_PLIST" ]]; then
  echo "Could not read ProgramArguments from plist."
  exit 1
fi

EXPECTED="${REPO_ROOT}/tools/scripts/reply_service.sh"
echo "LaunchAgent script path:     ${SCRIPT_IN_PLIST}"
echo "Expected for this checkout:  ${EXPECTED}"

if [[ "${SCRIPT_IN_PLIST}" == "${EXPECTED}" ]]; then
  echo "OK — paths match."
else
  echo ""
  echo "MISMATCH — the loaded hub points at a different checkout than this directory."
  echo "Fix: from this repo root run:  make run"
  exit 1
fi
