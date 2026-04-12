#!/usr/bin/env bash
# Build ReplyMenubar.app from Swift sources and install to ~/Applications.
# Invoked by: make install-ReplyMenubar (repo root).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CHAT_PKG="$REPO_ROOT/chat/package.json"
TEMPLATE="$SCRIPT_DIR/main.swift.template"
CORE="$SCRIPT_DIR/MenubarCore.swift"
DEST_APP="${HOME}/Applications/ReplyMenubar.app"
TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/reply-menubar-build.XXXXXX")"
cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

if ! command -v swiftc >/dev/null 2>&1; then
  echo "error: swiftc not found. Install Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi

if [[ ! -f "$TEMPLATE" || ! -f "$CORE" ]]; then
  echo "error: missing $TEMPLATE or $CORE" >&2
  exit 1
fi

VERSION="0.5.13"
if [[ -f "$CHAT_PKG" ]] && command -v node >/dev/null 2>&1; then
  VERSION="$(node -p "require('$CHAT_PKG').version" 2>/dev/null || echo "$VERSION")"
fi

MAIN_SWIFT="$TMPDIR/main.swift"
python3 <<PY
import json
from pathlib import Path

repo = Path("${REPO_ROOT}").resolve()
ver = "${VERSION}"
tpl = Path("${TEMPLATE}").read_text(encoding="utf-8")
tpl = tpl.replace("__APP_VERSION__", ver)
# Swift string literal: escape backslashes and double-quotes
root_esc = str(repo).replace("\\\\", "\\\\\\\\").replace('"', '\\\\"')
tpl = tpl.replace("__REPO_ROOT__", root_esc)
Path("${MAIN_SWIFT}").write_text(tpl, encoding="utf-8")
PY

BINARY="$TMPDIR/ReplyMenubar"
swiftc -O \
  -target "$(uname -m)-apple-macosx13.0" \
  -framework AppKit \
  -framework Foundation \
  -framework CoreText \
  -o "$BINARY" \
  "$MAIN_SWIFT" \
  "$CORE"

mkdir -p "$DEST_APP/Contents/MacOS"
mkdir -p "$DEST_APP/Contents/Resources"
cp "$BINARY" "$DEST_APP/Contents/MacOS/ReplyMenubar"
chmod +x "$DEST_APP/Contents/MacOS/ReplyMenubar"

FONT_SRC="$SCRIPT_DIR/MaterialSymbolsOutlined.ttf"
if [[ -f "$FONT_SRC" ]]; then
  cp "$FONT_SRC" "$DEST_APP/Contents/Resources/"
fi

cat > "$DEST_APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>ReplyMenubar</string>
  <key>CFBundleIdentifier</key>
  <string>com.reply.menubar</string>
  <key>CFBundleName</key>
  <string>ReplyMenubar</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
PLIST

echo "Installed: $DEST_APP"
echo "Launch: open \"$DEST_APP\"   or   make run-ReplyMenubar"
