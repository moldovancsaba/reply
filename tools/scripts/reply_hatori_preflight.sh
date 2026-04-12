#!/usr/bin/env bash
# Preflight: sibling hatori checkout, ~/.config/hatori/hatori.env, optional API health.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
HATORI_ROOT="$(cd "${REPO_ROOT}/.." && pwd)/hatori"
API_PORT="${REPLY_HATORI_PORT:-23572}"

echo "=== {reply} ↔ {hatori} preflight ==="
echo "reply root:  ${REPO_ROOT}"
echo "hatori root: ${HATORI_ROOT}"

if [[ ! -d "${HATORI_ROOT}/.git" ]]; then
  echo "MISSING: ${HATORI_ROOT}"
  echo "Fix: from ${REPO_ROOT} run:  make hatori-clone"
  exit 1
fi
echo "OK: hatori clone present"

ENV_FILE="${HOME}/.config/hatori/hatori.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "MISSING: ${ENV_FILE}"
  echo "Fix: cd ${HATORI_ROOT} && ./tools/scripts/hatori_env_init.sh"
  exit 1
fi
echo "OK: ${ENV_FILE}"

if docker info >/dev/null 2>&1; then
  echo "OK: docker daemon reachable"
else
  echo "WARN: docker not running — start Colima or Docker Desktop before \`make up\` in hatori"
fi

if curl -fsS "http://127.0.0.1:${API_PORT}/v1/health" >/dev/null 2>&1; then
  echo "OK: Hatori API http://127.0.0.1:${API_PORT}/v1/health"
else
  echo "DOWN: Hatori API (expected after: cd ${HATORI_ROOT} && make up && make run)"
fi

LOCAL_ENV="${REPO_ROOT}/chat/.env.local"
if [[ -f "${LOCAL_ENV}" ]] && grep -q '^[[:space:]]*REPLY_USE_HATORI=1' "${LOCAL_ENV}" 2>/dev/null; then
  echo "OK: ${LOCAL_ENV} enables REPLY_USE_HATORI"
elif [[ -f "${REPO_ROOT}/chat/.env" ]] && grep -q '^[[:space:]]*REPLY_USE_HATORI=1' "${REPO_ROOT}/chat/.env" 2>/dev/null; then
  echo "OK: chat/.env enables REPLY_USE_HATORI"
else
  echo "NOTE: REPLY_USE_HATORI=1 not found in chat/.env.local or chat/.env — suggestions use Ollama only until set"
fi

echo "=== preflight done ==="
