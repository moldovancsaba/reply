#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# verify-foundation.sh
# 
# Comprehensive health check for the {reply} and OpenClaw foundation.
# This script ensures that both main and parallel instances are correctly
# isolated, configured for security, and ready for work.
# ─────────────────────────────────────────────────────────────────────────────

set -e

# --- Configuration ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPLY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MAIN_STATE="$HOME/.openclaw"
PARALLEL_STATE="$HOME/.openclaw-parallel"
MAIN_PORT=18789
PARALLEL_PORT=18889

# --- Colors ---
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "===================================================="
echo "      {reply} Foundation Verification Script"
echo "===================================================="

check_config() {
  local state_dir="$1"
  local expected_port="$2"
  local label="$3"
  local pass=true

  echo -n "Checking $label config ($state_dir)... "

  if [[ ! -f "$state_dir/openclaw.json" ]]; then
    echo -e "${RED}MISSING${NC} (openclaw.json not found)"
    return 1
  fi

  # 1. Port Verification
  local actual_port
  actual_port=$(/usr/bin/python3 -c "import json; print(json.load(open('$state_dir/openclaw.json')).get('gateway', {}).get('port', 0))" 2>/dev/null || echo "error")
  if [[ "$actual_port" != "$expected_port" ]]; then
    echo -e "${RED}FAILED${NC} (expected port $expected_port, found $actual_port)"
    pass=false
  fi

  # 2. Security Fallback Verification
  if ! /usr/bin/grep -q "dangerouslyAllowHostHeaderOriginFallback" "$state_dir/openclaw.json"; then
    echo -e "${YELLOW}WARNING${NC} (security fallback flag missing)"
    pass=false
  fi

  # 3. Workspace Isolation (for parallel)
  if [[ "$label" == "Parallel Instance" ]]; then
    local workspace
    workspace=$(/usr/bin/python3 -c "import json; print(json.load(open('$state_dir/openclaw.json')).get('agents', {}).get('defaults', {}).get('workspace', ''))" 2>/dev/null || echo "error")
    if [[ "$workspace" != *"-parallel"* ]]; then
      echo -e "${YELLOW}WARNING${NC} (workspace not isolated: $workspace)"
      pass=false
    fi
  fi

  if [ "$pass" = true ]; then
    echo -e "${GREEN}OK${NC}"
  else
    echo -e "  -> ${YELLOW}Review $state_dir/openclaw.json${NC}"
  fi
}

check_port_availability() {
  local port="$1"
  local label="$2"
  echo -n "Checking port $port ($label)... "
  if /usr/sbin/lsof -iTCP:"$port" -sTCP:LISTEN -n -P > /dev/null 2>&1; then
    local pid
    pid=$(/usr/sbin/lsof -t -iTCP:"$port" -sTCP:LISTEN)
    echo -e "${YELLOW}BUSY${NC} (PID: $pid)"
  else
    echo -e "${GREEN}FREE${NC}"
  fi
}

# --- Execution ---

# 1. Check Directories
echo "Checking Project Root: $REPLY_DIR"
if [[ -d "$REPLY_DIR" ]]; then
  echo -e "  Root: ${GREEN}EXISTS${NC}"
else
  echo -e "  Root: ${RED}MISSING${NC}"
fi

# 2. Check Configurations
check_config "$MAIN_STATE" "$MAIN_PORT" "Main Instance" || true
check_config "$PARALLEL_STATE" "$PARALLEL_PORT" "Parallel Instance" || true

# 3. Check Ports
check_port_availability "$MAIN_PORT" "Main Gateway"
check_port_availability "$PARALLEL_PORT" "Parallel Gateway"
check_port_availability 3000 "Reply Server"

# 4. Sync Token Verification
echo -n "Checking Token Sync... "
if [[ -f "$REPLY_DIR/chat/.env" ]] && [[ -f "$MAIN_STATE/openclaw.json" ]]; then
  ENV_TOKEN=$(/usr/bin/grep "REPLY_OPENCLAW_GATEWAY_TOKEN" "$REPLY_DIR/chat/.env" | cut -d'=' -f2 | tr -d '"' | tr -d "'")
  JSON_TOKEN=$(/usr/bin/python3 -c "import json; print(json.load(open('$MAIN_STATE/openclaw.json')).get('gateway', {}).get('auth', {}).get('token', ''))" 2>/dev/null)
  
  if [[ -n "$ENV_TOKEN" ]] && [[ "$ENV_TOKEN" == "$JSON_TOKEN" ]]; then
    echo -e "${GREEN}MATCHED${NC}"
  else
    echo -e "${YELLOW}MISMATCH${NC}"
    echo "  .env: $ENV_TOKEN"
    echo "  json: $JSON_TOKEN"
  fi
else
  echo -e "${YELLOW}SKIPPED${NC} (files missing)"
fi

echo "===================================================="
echo "Foundation verification complete."
