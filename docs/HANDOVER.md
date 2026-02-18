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
  - Mandatory flow for every issue: create in SSOT repo -> add to Project 1 -> set board fields/status -> verify membership before ending task.
  - Never maintain local ideabank/tasklist/roadmap files in this repo.

## Current Priorities (Board)
- P1 In Progress: `mvp-factory-control#202` — `{reply}: Implement omnichannel routing + human-gated NBA orchestration`
- P1 In Progress: `mvp-factory-control#199` — `{reply}: Adopt OpenClaw security policy + approvals baseline`
- P0 Ready: `mvp-factory-control#196` — `{reply}: Stabilize WhatsApp Desktop send (⌘N flow)`
- P1 Ready: `mvp-factory-control#197` — `{reply}: Conversation list indexing (order/search/counts) cleanup`
- P1 Backlog: `mvp-factory-control#201` — `{reply}: Implement secure digital-me memory index + retrieval controls`
- P2 Backlog: `mvp-factory-control#200` — `{reply}: Build channel-aware KYC provenance model (OpenClaw-inspired)`
- P2 Idea Bank: `mvp-factory-control#195` — `{reply}: Manage multiple mailboxes`

## Docs Index
- `README.md` — quickstart
- `docs/ARCHITECTURE.md` — system overview
- `docs/APP_NAVIGATION.md` — “where is X?” UI/code map
- `docs/INGESTION.md` — sync/ingestion details
- `docs/PROJECT_MANAGEMENT.md` — board rules/fields
- `docs/HUMAN_FINAL_DECISION_POLICY.md` — mandatory human-in-the-loop policy
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
- WhatsApp UI automation is still flaky across WhatsApp builds/UI states; keep it defensive and validate on the real UI (tracked in `mvp-factory-control#196`).

## Recent Shipped (2026-02-18)
- Email dashboard: `/api/system-health` now counts ingested email docs from LanceDB using `source IN ('Gmail','IMAP','Mail','mbox')`, fixing the “Email Sync = 0” mismatch.
- Gmail Settings: configurable Gmail sync scope (Inbox+Sent / All Mail / Custom query).

## Active Session Update (2026-02-18, 70% handover trigger)
- Added policy doc: `docs/HUMAN_FINAL_DECISION_POLICY.md` (human final decision + deny-by-default control model).
- Added security enforcement module: `chat/security-policy.js`.
- Added security audit tooling: `chat/security-audit.js` with npm scripts `security:audit` and `security:fix`.
- Enforced sensitive-route authorization in `chat/server.js` for:
  - outbound send routes (`/api/send-imessage`, `/api/send-whatsapp`, `/api/send-email`)
  - sync routes (`/api/sync-imessage`, `/api/sync-whatsapp`, `/api/sync-mail`, `/api/sync-notes`)
  - mutation/control routes (`/api/kyc` POST, `/api/settings` POST, `/api/gmail/disconnect`, `/api/analyze-contact`)
- Replaced shell-based execution with argv-based `execFile` in updated iMessage/sync execution paths.
- Ran security checks:
  - `node chat/security-audit.js --fix`
  - `node chat/security-audit.js` => `critical=0`, `warn=1` (`operator token` not enforced unless configured).
- SSOT updates:
  - Progress comments posted to `mvp-factory-control#199` and `mvp-factory-control#202`.
  - Project 1 statuses set to **In Progress** for #199 and #202.
  - Machine-readable local tracker files (e.g. `project_id_query.json`) intentionally unchanged; GitHub Project 1 remains canonical tracker.

## Active Session Update (2026-02-18, continuation window)
- Enabled local operator-token runtime settings in `chat/.env`:
  - `REPLY_OPERATOR_TOKEN`
  - `REPLY_SECURITY_REQUIRE_OPERATOR_TOKEN=true`
  - `REPLY_SECURITY_LOCAL_WRITES_ONLY=true`
  - `REPLY_SECURITY_REQUIRE_HUMAN_APPROVAL=true`
- Added minimal OpenClaw sidecar inbound contract module: `chat/channel-bridge.js`.
  - Normalizes inbound payload to `{channel, peer, messageId, text, timestamp, attachments}`.
  - Ingests normalized events into LanceDB + contact store via `addDocuments` and `updateLastContacted`.
  - Supports idempotent retries (duplicate detection by stable bridge doc id).
  - Persists seen bridge doc ids in `chat/data/channel_bridge_seen.json` for restart-safe dedupe.
- Added local sidecar helper CLI: `chat/channel-bridge-sidecar.js`.
  - Accepts JSON/NDJSON/array input from `--event`, `--file`, or stdin.
  - Posts events to `/api/channel-bridge/inbound` with operator-token header.
  - Supports `--dry-run` passthrough and `--batch` mode.
- Added new sensitive route in `chat/server.js`:
  - `POST /api/channel-bridge/inbound` (local-only + operator-token enforced; human-approval bypassed for inbound ingestion).
  - Supports `dryRun=true` for normalization validation without writes.
  - Supports batch payloads (JSON arrays or `{events:[...]}`) with `accepted/skipped/errors` counters.
  - Added read-only observability route: `GET /api/channel-bridge/events?limit=50`.
- Extended channel compatibility for sidecar channels:
  - `pathPrefixesForHandle` now includes `telegram://` and `discord://`.
  - `channelFromDoc` and source inference now recognize Telegram/Discord.
- Added UI-level draft-only enforcement for external channels:
  - Composer channel picker now includes Telegram/Discord as `Draft only`.
  - Send button is disabled for Telegram/Discord to prevent accidental cross-channel sends.
  - Channel policy hint is shown when a draft-only channel is selected.
  - API client `sendMessage` now fails fast for unsupported channels instead of silently falling back.
- Added rollout controls for bridge channels in Settings:
  - New Bridge settings section exposes `telegram`/`discord` inbound mode (`draft_only` or `disabled`).
  - `/api/settings` now persists `channelBridge.channels.<channel>.inboundMode`.
  - `/api/channel-bridge/inbound` enforces these flags server-side and returns `403 channel_bridge_disabled` when blocked.
- Added dashboard visibility for bridge health:
  - Dashboard now shows Channel Bridge card (recent ingested/duplicate/error counts + current Telegram/Discord inbound mode).
  - Dashboard now uses compact `GET /api/channel-bridge/summary` aggregation endpoint (instead of stitching events+settings client-side).
- Added bridge summary endpoint:
  - `GET /api/channel-bridge/summary?limit=200` returns aggregate counters, per-channel status, rollout modes, and last event timestamps.
- Added conversation-level bridge policy visibility:
  - `/api/conversations` now includes `bridgePolicy` for bridge-managed channels (Telegram/Discord).
  - Sidebar contact rows render a bridge policy badge (e.g. `Telegram draft_only`) for operator awareness.
- SSOT note:
  - Attempt to post additional progress comment to `mvp-factory-control#202` failed due GitHub API rate limit (`GraphQL: API rate limit already exceeded for user ID 2206999`).
  - Re-attempt during latest continuation also failed with the same rate limit error.
  - Later retry succeeded: https://github.com/moldovancsaba/mvp-factory-control/issues/202#issuecomment-3919995606
- Hardened persistent file permissions:
  - `chat/settings-store.js` now writes `settings.json` with mode `600`.
  - `chat/contact-store.js` now writes `contacts.json` with mode `600`.
- Validation executed:
  - Sensitive route checks on `/api/settings`: no token => `401`, token/no approval => `403`, token+approval => `200`.
  - Outbound gating check on `/api/send-imessage`: token/no approval => `403`.
  - Sidecar route checks on `/api/channel-bridge/inbound`: no token => `401`, token + `dryRun` => `200`, token + live ingest => `200`.
  - Retrieval checks:
    - `/api/thread?handle=openclaw_test_user` returns `channel: "telegram"` message.
    - `/api/thread?handle=codex_test#42` returns `channel: "discord"` message (via `--data-urlencode`).
  - Sidecar CLI checks:
    - `node chat/channel-bridge-sidecar.js --help` prints usage.
    - `node chat/channel-bridge-sidecar.js --file ... --dry-run` returns `status=dry-run`.
    - `node chat/channel-bridge-sidecar.js --file ...` returns `status=ok`.
    - `node chat/channel-bridge-sidecar.js --file ... --batch` returns batch summary counts.
  - Idempotency checks:
    - second POST replay of same `{channel,messageId}` returns `status=duplicate`.
    - batch request with repeated message id returns `skipped > 0`.
  - Lineage checks:
    - `GET /api/channel-bridge/events?limit=10` returns recent `ingested/duplicate/error` records.
  - Rollout enforcement checks:
    - Setting `channelBridge.channels.telegram.inboundMode=disabled` blocks Telegram ingress with `403 channel_bridge_disabled`.
    - Restoring Telegram to `draft_only` re-enables ingress.
  - Summary endpoint checks:
    - After one ingest + one duplicate replay, `/api/channel-bridge/summary` returned `ingested=1`, `duplicate=1`.
  - Conversations policy checks:
    - `/api/conversations?q=batch3` and `/api/conversations?q=rollout_check` include `bridgePolicy` with `inboundMode=draft_only`.
  - Security audit (with env sourced) now reports `critical=0 warn=0`.

## Current Status / Known Issues (SSOT)
- `{reply}: Implement omnichannel routing + human-gated NBA orchestration` — https://github.com/moldovancsaba/mvp-factory-control/issues/202
  - Status: In Progress.
  - Current step: minimal Telegram/Discord-capable inbound sidecar contract implemented (`/api/channel-bridge/inbound`, draft-only inbound flow); next is full OpenClaw sidecar wiring + channel rollout controls.
- `{reply}: Adopt OpenClaw security policy + approvals baseline` — https://github.com/moldovancsaba/mvp-factory-control/issues/199
  - Status: In Progress.
  - Current step: route-level approval gates + security audit/fix CLI + operator token runtime enforcement are in place.
  - Remaining hardening: propagate operator-token handling through all operator environments and keep periodic audit checks green.
- `{reply}: Stabilize WhatsApp Desktop send (⌘N flow)` — https://github.com/moldovancsaba/mvp-factory-control/issues/196
  - Status: still flaky depending on WhatsApp UI state (popovers, wrong focus, WhatsApp vs WhatsApp Beta).
  - Safety: automation remains defensive to avoid sending the recipient as a message.
- `{reply}: Conversation list indexing (order/search/counts) cleanup` — https://github.com/moldovancsaba/mvp-factory-control/issues/197
  - Bug: `/api/conversations` currently runs in `meta.mode = fallback` because the “db index” helpers (e.g. `getConversationsIndexFresh`, query matching) are not wired; server-side `q=` filtering is effectively disabled.
  - Note: WIP branch `codex/wip-conversations-index` exists in `moldovancsaba/reply` (commit `788e3f3`) with a partial conversations index cache + sidebar `q=` wiring (use only if you want to continue that approach).

## Quick Verification (dev)
- Security baseline:
  - `cd /Users/moldovancsaba/Projects/reply && /opt/homebrew/bin/node chat/security-audit.js`
  - `cd /Users/moldovancsaba/Projects/reply && /opt/homebrew/bin/node chat/security-audit.js --fix`
- Channel bridge CLI:
  - `cd /Users/moldovancsaba/Projects/reply/chat && /opt/homebrew/bin/node channel-bridge-sidecar.js --help`
  - `cd /Users/moldovancsaba/Projects/reply/chat && /opt/homebrew/bin/node channel-bridge-sidecar.js --event '{"channel":"telegram","peer":{"handle":"@qa"},"text":"hello"}' --dry-run`
- Email count:
  - `GET /api/system-health` → expect `channels.mail.processed > 0` after Gmail/IMAP/Mail sync.
- Contacts list mode:
  - `GET /api/conversations?offset=0&limit=10` → currently expects `meta.mode = fallback` until #197 is completed.
- WhatsApp send (safe):
  - `POST /api/send-whatsapp` with `{"recipient":"+3670...","text":"...","dryRun":true}` should return `ok` without sending.
