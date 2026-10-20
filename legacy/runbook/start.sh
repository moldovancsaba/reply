#!/usr/bin/env bash
# Start the {reply} hub in the current user session so Apple-private sources remain readable.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "{reply}: starting hub in session mode from ${ROOT}…"
exec make run
