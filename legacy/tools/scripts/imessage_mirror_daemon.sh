#!/usr/bin/env bash
set -euo pipefail

MIRROR_ROOT="${HOME}/Library/Application Support/reply/apple-source-mirrors/imessage"
PID_FILE="${HOME}/Library/Application Support/reply/imessage-mirror.pid"
LOG_FILE="${HOME}/Library/Logs/reply/imessage-mirror-daemon.log"
SOURCE_ROOT="${HOME}/Library/Messages"

mkdir -p "${MIRROR_ROOT}" "$(dirname "${PID_FILE}")" "$(dirname "${LOG_FILE}")"

if [[ -f "${PID_FILE}" ]]; then
  old_pid="$(cat "${PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${old_pid}" ]] && kill -0 "${old_pid}" 2>/dev/null; then
    exit 0
  fi
fi

(
  echo "$$" > "${PID_FILE}"
  trap 'rm -f "${PID_FILE}"; exit 0' INT TERM EXIT

  mirror_one() {
    local src="$1"
    local name
    name="$(basename "${src}")"
    local dst="${MIRROR_ROOT}/${name}"
    local tmp="${MIRROR_ROOT}/.${name}.tmp"

    [[ -r "${src}" ]] || return 0
    cp "${src}" "${tmp}"
    mv -f "${tmp}" "${dst}"
  }

  while true; do
    {
      printf '[%s] sync start\n' "$(date -u +%FT%TZ)"
      mirror_one "${SOURCE_ROOT}/chat.db"
      mirror_one "${SOURCE_ROOT}/chat.db-wal"
      mirror_one "${SOURCE_ROOT}/chat.db-shm"
      printf '[%s] sync ok\n' "$(date -u +%FT%TZ)"
    } >> "${LOG_FILE}" 2>&1 || true
    sleep 15
  done
) >/dev/null 2>&1 &
