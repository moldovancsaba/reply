#!/usr/bin/env bash
# Builds the helper and records its SHA-256 next to the binary. The Node side refuses to run a binary whose hash differs.
set -euo pipefail
cd "$(dirname "$0")"
swift build -c release
mkdir -p bin
cp .build/release/reply-core-helper bin/reply-core-helper
shasum -a 256 bin/reply-core-helper | cut -d' ' -f1 > bin/reply-core-helper.sha256
echo "built bin/reply-core-helper $(bin/reply-core-helper --version)"
