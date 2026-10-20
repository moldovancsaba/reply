#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$PROJECT_DIR/../.." && pwd)"
APP_NAME="reply"
HELPER_NAME="reply-helper"
BUILD_DIR="$PROJECT_DIR/.build/debug"
BUNDLE_DIR="$PROJECT_DIR/dist"
APP_BUNDLE="$BUNDLE_DIR/$APP_NAME.app"
RUNTIME_NAME="reply runtime"
CORE_DIR_NAME="reply-core"
TRINITY_REPO_ROOT="$(cd "$REPO_ROOT/../trinity" && pwd)"
TRINITY_RUNTIME_DIR_NAME="trinity-runtime"
ICON_BUILD_DIR="$PROJECT_DIR/.build/icon-assets"
ICON_PATH="$ICON_BUILD_DIR/reply.icns"

resolve_node() {
  if [[ -n "${REPLY_NODE_BIN:-}" && -x "${REPLY_NODE_BIN}" ]]; then
    printf '%s\n' "${REPLY_NODE_BIN}"
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
  local cellar_candidate
  cellar_candidate="$(find /opt/homebrew/Cellar /usr/local/Cellar -path '*/bin/node' -type f 2>/dev/null | sort -V | tail -n 1 || true)"
  if [[ -n "$cellar_candidate" && -x "$cellar_candidate" ]]; then
    printf '%s\n' "$cellar_candidate"
    return 0
  fi
  return 1
}

NODE_BIN="$(resolve_node)" || {
  echo "build-bundle.sh: Node.js not found." >&2
  exit 1
}
NODE_PREFIX="$(cd "$(dirname "$NODE_BIN")/.." && pwd)"
LIBNODE_PATH="$(find "$NODE_PREFIX/lib" -maxdepth 1 -name 'libnode*.dylib' | head -n 1 || true)"

cd "$PROJECT_DIR"
swift build
bash "$PROJECT_DIR/build-icon.sh" >/dev/null

rm -rf "$APP_BUNDLE" "$BUNDLE_DIR/Reply.app"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$APP_BUNDLE/Contents/Resources" "$APP_BUNDLE/Contents/Helpers"
cp "$BUILD_DIR/$APP_NAME" "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
chmod +x "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
cp "$BUILD_DIR/$HELPER_NAME" "$APP_BUNDLE/Contents/Helpers/$HELPER_NAME"
chmod +x "$APP_BUNDLE/Contents/Helpers/$HELPER_NAME"
cp "$NODE_BIN" "$APP_BUNDLE/Contents/Resources/$RUNTIME_NAME"
chmod +x "$APP_BUNDLE/Contents/Resources/$RUNTIME_NAME"
if [[ -n "$LIBNODE_PATH" && -f "$LIBNODE_PATH" ]]; then
  cp "$LIBNODE_PATH" "$APP_BUNDLE/Contents/Resources/"
fi
mkdir -p "$APP_BUNDLE/Contents/Resources/$CORE_DIR_NAME"
rsync -a --delete \
  --exclude ".env" \
  --exclude ".env.local" \
  --exclude "data/" \
  --exclude "logs/" \
  --exclude "test/" \
  --exclude "test-hybrid-db/" \
  --exclude "test-hybrid-db-final/" \
  --exclude "tmp-db/" \
  --exclude ".DS_Store" \
  "$REPO_ROOT/chat/" "$APP_BUNDLE/Contents/Resources/$CORE_DIR_NAME/chat/"
rsync -a --delete \
  --exclude ".DS_Store" \
  "$REPO_ROOT/public/" "$APP_BUNDLE/Contents/Resources/$CORE_DIR_NAME/public/"
mkdir -p "$APP_BUNDLE/Contents/Resources/$CORE_DIR_NAME/$TRINITY_RUNTIME_DIR_NAME"
rsync -a --delete \
  --exclude "__pycache__/" \
  --exclude ".pytest_cache/" \
  --exclude ".ruff_cache/" \
  "$TRINITY_REPO_ROOT/core/" "$APP_BUNDLE/Contents/Resources/$CORE_DIR_NAME/$TRINITY_RUNTIME_DIR_NAME/core/"
cp "$PROJECT_DIR/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
cp "$ICON_PATH" "$APP_BUNDLE/Contents/Resources/reply.icns"
echo -n "APPL????" > "$APP_BUNDLE/Contents/PkgInfo"

codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null 2>&1 || true

echo "$APP_BUNDLE"
