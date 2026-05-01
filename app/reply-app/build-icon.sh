#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSET_DIR="$PROJECT_DIR/Assets"
SVG_PATH="$ASSET_DIR/AppIcon.svg"
ICONSET_DIR="$ASSET_DIR/AppIcon.iconset"
ICNS_PATH="$ASSET_DIR/AppIcon.icns"

if [[ ! -f "$SVG_PATH" ]]; then
  echo "Missing source SVG: $SVG_PATH" >&2
  exit 1
fi

rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

render_png() {
  local size="$1"
  local output="$2"
  local scratch
  scratch="$(mktemp -d)"
  qlmanage -t -s "$size" -o "$scratch" "$SVG_PATH" >/dev/null 2>&1
  mv "$scratch/$(basename "$SVG_PATH").png" "$output"
  rmdir "$scratch"
}

render_png 16 "$ICONSET_DIR/icon_16x16.png"
render_png 32 "$ICONSET_DIR/icon_16x16@2x.png"
render_png 32 "$ICONSET_DIR/icon_32x32.png"
render_png 64 "$ICONSET_DIR/icon_32x32@2x.png"
render_png 128 "$ICONSET_DIR/icon_128x128.png"
render_png 256 "$ICONSET_DIR/icon_128x128@2x.png"
render_png 256 "$ICONSET_DIR/icon_256x256.png"
render_png 512 "$ICONSET_DIR/icon_256x256@2x.png"
render_png 512 "$ICONSET_DIR/icon_512x512.png"
render_png 1024 "$ICONSET_DIR/icon_512x512@2x.png"

iconutil -c icns -o "$ICNS_PATH" "$ICONSET_DIR"
echo "$ICNS_PATH"
