#!/usr/bin/env bash
# Wipe {reply}-derived local state (NOT Apple Messages / WhatsApp source DBs), git pull, restart hub.
# Removes: app-owned LanceDB index, unified chat.db, contacts.db, sync cursors, worker pid, suggestion queue.
# Preserves: chat/.env* and app-owned settings/persona artifacts.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CHAT="${REPO_ROOT}/chat"
DATA="$(
  node -e "const p=require('${CHAT}/app-paths.js'); process.stdout.write(p.getDataHome())"
)"
LANCE="$(
  node -e "const p=require('${CHAT}/vector-store.js'); process.stdout.write(String(process.env.REPLY_KNOWLEDGE_DB_PATH || process.env.REPLY_LANCEDB_URI || require('${CHAT}/app-paths.js').dataPath('lancedb')))"
)"

echo "==> Repo: ${REPO_ROOT}"

echo "==> Stopping {reply} hub (launchd + node on hub ports)…"
chmod +x "${SCRIPT_DIR}/stop.sh" 2>/dev/null || true
"${SCRIPT_DIR}/stop.sh" || true
sleep 3

echo "==> git pull --ff-only origin main"
cd "${REPO_ROOT}"
git pull --ff-only origin main

echo "==> Removing LanceDB (${LANCE})…"
rm -rf "${LANCE}"

echo "==> Removing unified messages + contacts SQLite…"
rm -f "${DATA}/chat.db" "${DATA}/chat.db-shm" "${DATA}/chat.db-wal" || true
rm -f "${DATA}/contacts.db" "${DATA}/contacts.db-shm" "${DATA}/contacts.db-wal" || true

echo "==> Removing sync cursors, status JSON, worker pid, draft queue…"
rm -f "${DATA}/sync_state.json" \
  "${DATA}/whatsapp_sync_state.json" \
  "${DATA}/imap_sync_state.json" \
  "${DATA}/gmail_sync_state.json" \
  "${DATA}/pending-suggestion-draft-queue.json" \
  "${DATA}/kyc_auto_scan_cursor.json" \
  "${DATA}/worker.pid" || true
rm -f "${DATA}"/*_sync_status.json 2>/dev/null || true

mkdir -p "${DATA}"

echo "==> Recreating empty unified_messages schema (chat.db)…"
cd "${CHAT}"
node -e "require('./message-store').initialize();"

echo "==> Reloading {reply} hub (make run from repo root)…"
cd "${REPO_ROOT}"
chmod +x ./tools/scripts/reply_service.sh 2>/dev/null || true
make run

echo ""
echo "Done. The worker will re-sync iMessage/WhatsApp/mail on its next poll; open the dashboard and use"
echo "per-channel Sync if you want to hurry. Contacts and vector rows rebuild from sources."
