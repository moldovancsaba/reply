#!/usr/bin/env zsh
# ─────────────────────────────────────────────────────────────────────────
# launch-openclaw-parallel.sh
#
# Starts a SECOND OpenClaw instance for personal use on port 18889
# while Reply keeps using its own instance on port 18789.
#
# Usage:
#   chmod +x scripts/launch-openclaw-parallel.sh
#   ./scripts/launch-openclaw-parallel.sh
#
# Or just run: ollama launch openclaw   after sourcing this env, e.g.:
#   source scripts/launch-openclaw-parallel.sh
# ─────────────────────────────────────────────────────────────────────────

export OPENCLAW_STATE_DIR="$HOME/.openclaw-parallel"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_STATE_DIR/openclaw.json"
export OPENCLAW_GATEWAY_PORT=18889

echo "──────────────────────────────────────────────"
echo "  Launching parallel OpenClaw instance"
echo "  State dir : $OPENCLAW_STATE_DIR"
echo "  Port      : $OPENCLAW_GATEWAY_PORT"
echo "  (Reply instance stays on port 18789)"
echo "──────────────────────────────────────────────"

# If the script was sourced, just export the env vars—don't exec
if [[ "$0" == "${BASH_SOURCE[0]:-$0}" ]]; then
  exec openclaw gateway --port 18889
fi
