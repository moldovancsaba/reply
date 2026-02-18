# {reply} — Developer Handover

This file is onboarding + operational context. Keep it accurate when behavior/architecture changes.

## SSOT (Work Tracking)
- Board: https://github.com/users/moldovancsaba/projects/1
- Issues repo: `moldovancsaba/mvp-factory-control`
- Rules:
  - Track Reply work only as issues in `mvp-factory-control` and as items on the board.
  - Do not create/manage issues in product repos (e.g. `moldovancsaba/reply`).
  - Issues are disabled in `moldovancsaba/reply` to prevent SSOT drift.
  - Issue title convention for Reply: `{reply}: <short description>`.
  - Naming: always use `{reply}` (no “Hub” or other renames).

## Docs Index
- `README.md` — quickstart
- `docs/ARCHITECTURE.md` — system overview
- `docs/APP_NAVIGATION.md` — “where is X?” UI/code map
- `docs/INGESTION.md` — sync/ingestion details
- `docs/PROJECT_MANAGEMENT.md` — board rules/fields
- `docs/RELEASE_NOTES.md` — shipped changes only

## Key Runtime Files
- `chat/server.js` — HTTP API + static server
- `chat/background-worker.js` — unified poll loop + intelligence pipeline
- `chat/vector-store.js` — LanceDB connect + `addDocuments`
- `chat/contact-store.js` — contact DB + last-contacted
- `chat/kyc-agent.js` — Profile → Analyze (signals + suggestions)

## Email Sync (Gmail / IMAP / Mail.app)
- Orchestrator: `chat/sync-mail.js` (prefers Gmail OAuth → IMAP → Mail.app fallback)
- Gmail OAuth:
  - Connector: `chat/gmail-connector.js`
  - Sync scope is configurable in Settings (Inbox+Sent / All Mail / Custom query)
- IMAP:
  - Connector: `chat/sync-imap.js`
  - Configure mailbox via Settings (e.g. Gmail “All Mail” via IMAP mailbox name)

## UI Navigation (fast)
- Dashboard: health cards + manual sync + per-service **⚙️** configuration.
- Feed: the thread + composer; `🎤 Mic`, `✨ Magic`, `💡 Suggest` are feed-only.
- Settings: full-page settings (gear icon), includes “Configure a service” shortcuts.

## Known Quirks
- `gh issue comment --body "..."` in `zsh`: backticks execute; prefer single quotes or `--body-file`.
- WhatsApp direct send requires WhatsApp Desktop running + macOS Accessibility permission (UI automation).

## Recent Shipped (2026-02-18)
- Email dashboard: `/api/system-health` now counts ingested email docs from LanceDB using `source IN ('Gmail','IMAP','Mail','mbox')`, fixing the “Email Sync = 0” mismatch.
- Gmail Settings: configurable Gmail sync scope (Inbox+Sent / All Mail / Custom query).

## Current Status / Known Issues (SSOT)
- `{reply}: Stabilize WhatsApp Desktop send (⌘N flow)` — https://github.com/moldovancsaba/mvp-factory-control/issues/196
  - Status: still flaky depending on WhatsApp UI state (popovers, wrong focus, WhatsApp vs WhatsApp Beta).
  - Safety: automation remains defensive to avoid sending the recipient as a message.
- `{reply}: Conversation list indexing (order/search/counts) cleanup` — https://github.com/moldovancsaba/mvp-factory-control/issues/197
  - Bug: `/api/conversations` currently runs in `meta.mode = fallback` because the “db index” helpers (e.g. `getConversationsIndexFresh`, query matching) are not wired; server-side `q=` filtering is effectively disabled.
  - Note: WIP branch `codex/wip-conversations-index` exists in `moldovancsaba/reply` (commit `788e3f3`) with a partial conversations index cache + sidebar `q=` wiring (use only if you want to continue that approach).

## Quick Verification (dev)
- Email count:
  - `GET /api/system-health` → expect `channels.mail.processed > 0` after Gmail/IMAP/Mail sync.
- Contacts list mode:
  - `GET /api/conversations?offset=0&limit=10` → currently expects `meta.mode = fallback` until #197 is completed.
- WhatsApp send (safe):
  - `POST /api/send-whatsapp` with `{"recipient":"+3670...","text":"...","dryRun":true}` should return `ok` without sending.
