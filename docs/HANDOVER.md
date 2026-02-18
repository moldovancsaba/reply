# {reply} — Developer Handover

This file is onboarding + operational context. Keep it accurate when behavior/architecture changes.

## SSOT (Work Tracking)
- Board: https://github.com/users/moldovancsaba/projects/1
- Issues repo: `moldovancsaba/mvp-factory-control`
- Rules:
  - Track Reply work only as issues in `mvp-factory-control` and as items on the board.
  - Do not create/manage issues in product repos (e.g. `moldovancsaba/reply`).
  - Issue title convention for Reply: `{reply}: <short description>`.

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

## Known Quirks
- `gh issue comment --body "..."` in `zsh`: backticks execute; prefer single quotes or `--body-file`.
- WhatsApp direct send requires WhatsApp Desktop running + macOS Accessibility permission (UI automation).
