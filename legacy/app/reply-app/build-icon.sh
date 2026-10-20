#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_ICON_DIR="$PROJECT_DIR/.build/icon-assets"
ICONSET_DIR="$BUILD_ICON_DIR/AppIcon.iconset"
ICON_PNG="$BUILD_ICON_DIR/app-icon-1024.png"
ICNS_PATH="$BUILD_ICON_DIR/reply.icns"
GENERATOR_SCRIPT="$PROJECT_DIR/Scripts/generate_app_icon.swift"

rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

if [[ ! -f "$GENERATOR_SCRIPT" ]]; then
  echo "Missing icon generator: $GENERATOR_SCRIPT" >&2
  exit 1
fi

swift "$GENERATOR_SCRIPT" "$ICON_PNG" >/dev/null

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$ICON_PNG" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null
  retina_size=$((size * 2))
  sips -z "$retina_size" "$retina_size" "$ICON_PNG" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns -o "$ICNS_PATH" "$ICONSET_DIR"
echo "$ICNS_PATH"
