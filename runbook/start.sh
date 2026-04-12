#!/usr/bin/env bash
# reply#65 — SSOT for starting the Reply hub on macOS: LaunchAgent (no nohup).
# Installs/reloads com.reply.hub from the repo root (same as `make run`).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "Reply: installing hub LaunchAgent from ${ROOT} (see Makefile install-service)…"
exec make run
