#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$PROJECT_DIR/../.." && pwd)"
APP_NAME="reply"
HELPER_NAME="reply-helper"
BUILD_DIR="$PROJECT_DIR/.build/debug"
BUNDLE_DIR="$PROJECT_DIR/dist"
APP_BUNDLE="$BUNDLE_DIR/$APP_NAME.app"
NODE_BIN="${REPLY_NODE_BIN:-$(command -v node)}"
RUNTIME_NAME="reply runtime"
CORE_DIR_NAME="reply-core"
NODE_PREFIX="$(cd "$(dirname "$NODE_BIN")/.." && pwd)"
LIBNODE_PATH="$(find "$NODE_PREFIX/lib" -maxdepth 1 -name 'libnode*.dylib' | head -n 1 || true)"
ICON_PATH="$PROJECT_DIR/Assets/AppIcon.icns"

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
cp "$PROJECT_DIR/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
cp "$ICON_PATH" "$APP_BUNDLE/Contents/Resources/AppIcon.icns"
echo -n "APPL????" > "$APP_BUNDLE/Contents/PkgInfo"
printf '%s\n' "$REPO_ROOT" > "$APP_BUNDLE/Contents/Resources/reply-repo-root.txt"

codesign --force --deep --sign - "$APP_BUNDLE" >/dev/null 2>&1 || true

echo "$APP_BUNDLE"
