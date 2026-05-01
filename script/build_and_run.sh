#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT_DIR/app/reply-app"
APP_BUNDLE="$APP_DIR/dist/reply.app"
MIRROR_DAEMON="$ROOT_DIR/tools/scripts/imessage_mirror_daemon.sh"

mkdir -p "$ROOT_DIR/.codex/environments"

pkill -x "reply" >/dev/null 2>&1 || true

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
  for _ in 1 2 3 4 5; do
    sleep 1
    if pgrep -fal "/Contents/MacOS/reply" >/dev/null || pgrep -x "reply" >/dev/null; then
      exit 0
    fi
  done
  echo "reply.app launched command but no reply process was detected."
  exit 1
fi
