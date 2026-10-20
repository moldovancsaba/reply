#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/app/reply-app"
APP_BUNDLE="$APP_DIR/dist/reply.app"
MIRROR_DAEMON="$ROOT_DIR/tools/scripts/imessage_mirror_daemon.sh"
PREFERRED_PORTS=($(seq 45311 45326) $(seq 45431 45446))

mkdir -p "$ROOT_DIR/.codex/environments"

pkill -x "reply" >/dev/null 2>&1 || true
pkill -f "/Contents/Resources/reply-core/chat/server.js" >/dev/null 2>&1 || true
pkill -f "/Contents/Resources/reply-core/chat/background-worker.js" >/dev/null 2>&1 || true

chmod +x "$MIRROR_DAEMON"
"$MIRROR_DAEMON" || true
MIRROR_DB="${HOME}/Library/Application Support/reply/apple-source-mirrors/imessage/chat.db"
for _ in 1 2 3 4 5; do
  [[ -r "$MIRROR_DB" ]] && break
  sleep 1
done

cd "$APP_DIR"
bash ./build-bundle.sh >/tmp/reply-app-build-path.txt

APP_PATH="$(tail -n 1 /tmp/reply-app-build-path.txt)"
if [[ ! -d "$APP_PATH" ]]; then
  echo "reply.app bundle was not created."
  exit 1
fi

/usr/bin/nohup /usr/bin/open -n "$APP_PATH" >/dev/null 2>&1 &

if [[ "${1:-}" == "--verify" ]]; then
  for _ in $(seq 1 60); do
    sleep 1
    for port in "${PREFERRED_PORTS[@]}"; do
      BODY="$(/usr/bin/curl -fsS --max-time 2 "http://127.0.0.1:${port}/api/health" 2>/dev/null || true)"
      [[ -z "$BODY" ]] && continue
      if /usr/bin/python3 - "$BODY" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
launch = payload.get("launch") or {}
ready = launch.get("ready")
status = payload.get("status")
ok = payload.get("ok")
if ready is True or status == "online" or ok is True:
    raise SystemExit(0)
raise SystemExit(1)
PY
      then
        echo "reply.app runtime ready on port ${port}"
        exit 0
      fi
    done
    if ! pgrep -fal "/Contents/MacOS/reply" >/dev/null && ! pgrep -x "reply" >/dev/null; then
      echo "reply.app launch did not leave a running native process."
      exit 1
    fi
  done
  echo "reply.app launched, but runtime readiness was not confirmed on any preferred port."
  exit 1
fi
