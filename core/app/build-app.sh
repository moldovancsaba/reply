#!/bin/bash
# Builds and signs ~/Applications/{reply}.app, the named host that starts Reply Core (see ReplyHost.swift).
# Usage: bash app/build-app.sh [destination-folder]      Needs the Xcode command line tools.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CORE="$(cd "$HERE/.." && pwd)"
DEST="${1:-$HOME/Applications}"
APP="$DEST/{reply}.app"
NODE="${REPLY_CORE_NODE:-$(command -v node)}"
NODE="$(cd "$(dirname "$NODE")" && pwd -P)/$(basename "$NODE")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -o "$APP/Contents/MacOS/reply" "$HERE/ReplyHost.swift"

swift "$HERE/make-icon.swift" "$WORK/icon.png"
ICONSET="$WORK/AppIcon.iconset"; mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
    sips -z $s $s "$WORK/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$WORK/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Resources/reply-core.json" <<JSON
{ "node": "$NODE", "entry": "$CORE/src/index.js", "cwd": "$CORE", "launcher": "$CORE/scripts/reply-core" }
JSON
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>{reply}</string>
  <key>CFBundleDisplayName</key><string>{reply}</string>
  <key>CFBundleIdentifier</key><string>com.moldovancsaba.reply</string>
  <key>CFBundleExecutable</key><string>reply</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSContactsUsageDescription</key><string>{reply} reads your address book so conversations show real names and one person's phone numbers and email addresses are grouped. Nothing leaves this Mac.</string>
</dict>
</plist>
PLIST

# A stable signing identity keeps the Full Disk Access grant across rebuilds; ad-hoc is the fallback.
IDENTITY="${REPLY_CORE_SIGN_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Development[^"]*\)".*/\1/p' | head -1)}"
codesign --force --options runtime --entitlements "$HERE/ReplyHost.entitlements" --sign "${IDENTITY:--}" "$APP"
codesign --verify --strict "$APP"
touch "$APP"
echo "Built $APP (signed with ${IDENTITY:-ad-hoc})"
