# {reply} — Developer Handover

This file is onboarding + operational context. Keep it accurate when behavior/architecture changes.

**Last Updated**: 2026-02-22 (Sprint 1 planning complete, foundation verified, blockers resolved)

## SSOT (Work Tracking)
- Board: https://github.com/users/moldovancsaba/projects/1
- Issues repo: `moldovancsaba/mvp-factory-control`
- Rules:
  - Track `{reply}` work only as issues in `mvp-factory-control` and as items on the board.
  - Do not create/manage issues in product repos (e.g. `moldovancsaba/reply`).
  - Issues are disabled in `moldovancsaba/reply` to prevent SSOT drift.
  - Issue title convention for Reply: `{reply}: <short description>`.
  - Naming: always use `{reply}` (no “Hub” or other renames).
  - Mandatory flow for every issue: create in SSOT repo -> add to Project 1 -> set board fields/status -> verify membership before ending task.
  - **CRITICAL RULE**: Never maintain local `task.md`, `IDEABANK.md`, `ROADMAP.md` or similar files in this repo. The GitHub Project Board is the ONLY truth.

## Current Priorities (Board, 2026-02-22)

### Foundation Verification — COMPLETE ✅
- **#212 (CI Pipeline)** — ✅ VERIFIED: `.github/workflows/ci.yml` working, runs ESLint + Jest
- **#213 (SQL Audit)** — ✅ VERIFIED: All 4 string-interpolated SQL calls use `escapeSqlString()`, no injection risk

### 2-Week Sprint Plan (Sprint 1 + Sprint 2)
See detailed plans:
- **[DEPENDENCY_MAP.md](DEPENDENCY_MAP.md)** — Blocking relationships, critical path, 3-4 week timeline
- **[BACKLOG_PRIORITIZATION.md](BACKLOG_PRIORITIZATION.md)** — ROI-scored ranking (16 = #212, 5.0 = #213, #223)
- **[SPRINT_PLAN_2W.md](SPRINT_PLAN_2W.md)** — Day-by-day execution plan (Sprint 1: foundation, Sprint 2: refactor + settings)

### Knowledge Base
- **[BRAIN_DUMP.md](BRAIN_DUMP.md)** — Operational state, technical decisions, gotchas, risk registry (syncs after every issue)

### Active Issues
- ✅ P0 Done: `mvp-factory-control#196` — `{reply}: Stabilize WhatsApp Desktop send (⌘N flow)` *(closed 2026-02-18)*
- 🔄 P1 In Progress: `mvp-factory-control#197` — `{reply}: Conversation list indexing (order/search/counts) cleanup`
- 🔄 P1 In Progress: `mvp-factory-control#202` — `{reply}: Implement omnichannel routing + human-gated NBA orchestration`
- 🟡 P1 Ready: `mvp-factory-control#214` — `{reply}: Add loading states and error toast notifications` (independent, start immediately)
- 🔴 P1 Backlog: `mvp-factory-control#211` — `{reply}: Decompose server.js into route modules` (unblocks #223, #224, #221, #220)
- ✅ P0 Done: `mvp-factory-control#212` — `{reply}: Add CI pipeline (GitHub Actions lint + test)` (verified working 2026-02-22)
- ✅ P0 Done: `mvp-factory-control#213` — `{reply}: Replace string-interpolated SQL with parameterized queries` (verified safe 2026-02-22)
- 🟡 P2 Backlog: `mvp-factory-control#215` — `{reply}: First-run onboarding wizard`
- 🟡 P2 Backlog: `mvp-factory-control#216` — `{reply}: Mobile responsiveness and accessibility improvements`
- 🟡 P2 Backlog: `mvp-factory-control#217` — `{reply}: Local analytics instrumentation`
- 🟡 P2 Backlog: `mvp-factory-control#218` — `{reply}: Data export CLI for portability`
- 🟡 P2 Backlog: `mvp-factory-control#219` — `{reply}: Version strategy and changelog`
- 🟡 P2 Backlog: `mvp-factory-control#223` — `{reply}: AI Provider Cards (Ollama + OpenClaw selector)` (depends on #211)
- 🟡 P2 Backlog: `mvp-factory-control#224` — `{reply}: Smart Prompt Library (templates + chaining)` (depends on #211)
- 🟡 P2 Backlog: `mvp-factory-control#221` — `{reply}: Settings Hub (consolidated provider config)` (depends on #211, clarify #197 blocker)
- 🟡 P2 Backlog: `mvp-factory-control#220` — `{reply}: Scope LinkedIn send capability (API vs clipboard)` (ADR required)
- ✅ P0 Done: `mvp-factory-control#199` — `{reply}: Adopt OpenClaw security policy + approvals baseline` *(closed 2026-02-18)*

## Docs Index
- `README.md` — quickstart
- `docs/ARCHITECTURE.md` — system overview
- `docs/APP_NAVIGATION.md` — “where is X?” UI/code map
- `docs/BRAIN_DUMP.md` — **Operational knowledge base (syncs after every issue completion)**
- `docs/INGESTION.md` — sync/ingestion details
- `docs/PROJECT_MANAGEMENT.md` — board rules/fields
- `docs/HUMAN_FINAL_DECISION_POLICY.md` — mandatory human-in-the-loop policy
- `docs/CHANNEL_INTEGRATION_CASE_STUDY.md` — reusable channel hardening blueprint (OpenClaw WhatsApp reference)
- `docs/RELEASE_NOTES.md` — shipped changes only
- `docs/DEPENDENCY_MAP.md` — Blocking relationships and critical path
- `docs/BACKLOG_PRIORITIZATION.md` — ROI-scored ranking matrix
- `docs/SPRINT_PLAN_2W.md` — Day-by-day execution plan

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
- Desktop launcher (`/Users/moldovancsaba/Desktop/Launch Reply.command`) now runs in dumb-safe mode: always kills existing listeners on `3000` + `18789` before starting fresh.

## Recent Shipped (2026-02-18)
- Email dashboard: `/api/system-health` now counts ingested email docs from LanceDB using `source IN ('Gmail','IMAP','Mail','mbox')`, fixing the “Email Sync = 0” mismatch.
- Gmail Settings: configurable Gmail sync scope (Inbox+Sent / All Mail / Custom query).
- WhatsApp send hardening: OpenClaw send failures caused by missing listener/gateway/session now auto-fallback to Desktop automation for one retry.
- KYC save hardening: profile/note/suggestion write actions now include required approval/token metadata in UI calls, fixing save failures after security policy enforcement.
- Email duplicate fix: Gmail incremental sync no longer re-runs full initial sync when history returns no new events (prevents duplicated old messages).
- Count alignment: history reads are dedupe-aware, and conversation counts now reflect deduped thread history.

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

## Active Session Update (2026-02-18, channel expansion + docs sync)
- Expanded draft-only bridge-managed channels beyond Telegram/Discord:
  - Added `signal`, `viber`, `linkedin` to bridge rollout defaults in `chat/settings-store.js`.
  - `/api/settings` channel-bridge save path now persists inbound modes for all 5 bridge channels.
  - Server bridge policy visibility now applies to all 5 bridge channels in `/api/conversations`.
  - Dashboard bridge card now shows rollout status for Telegram/Discord/Signal/Viber/LinkedIn.
  - Settings UI Bridge section now exposes inbound mode toggles for all 5 channels.
- Expanded channel normalization + retrieval:
  - `chat/channel-bridge.js` now accepts `viber` events and strips additional channel schemes.
  - `chat/server.js` now recognizes `signal://`, `viber://`, `linkedin://` in path parsing and source inference.
  - `pathPrefixesForHandle` now includes `signal://`, `viber://`, `linkedin://` to improve thread lookup consistency.
- Composer policy updated:
  - Channel picker now includes `Signal`, `Viber`, `LinkedIn` as Draft only.
  - Send remains enabled only for `iMessage`, `WhatsApp`, `Email`.
  - Draft-only enforcement now includes Telegram/Discord/Signal/Viber/LinkedIn.
- OpenClaw transport reality check on this machine:
  - `openclaw message send --channel signal|viber|linkedin` currently returns `Unknown channel`.
  - Therefore these channels remain inbound/draft-only in `{reply}` for now.
- Documentation refreshed to match behavior:
  - `README.md`, `docs/USER_GUIDE.md`, `docs/APP_NAVIGATION.md`, `docs/CHANNEL_BRIDGE.md`, `docs/RELEASE_NOTES.md`, and this handover doc.

## Active Session Update (2026-02-18, global audit)

### What was done (commits on `main`)
- `cd0d7b2` — **Phase 1 security hardening:**
  - Removed `chat/.env` from Git tracking (secrets exposure fix). ⚠️ **Rotate GOOGLE_API_KEY and REPLY_OPERATOR_TOKEN — they were in Git history.**
  - `isLocalRequest()` in `chat/security-policy.js` now uses raw socket address, ignoring spoofable `X-Forwarded-For`.
  - Installed ESLint 9 + flat config (`chat/eslint.config.mjs`). `npm run lint` and `npm run lint:fix` added.
  - Fixed real bug: `runAppleScript()` was called but never defined in `chat/sync-notes.js` — would crash Apple Notes sync.
  - Moved stale Swift stubs + project-management JSON to `archive/`. Temp dirs added to `.gitignore`.
- `6384996` — **CORS, CSP, rate limiting:**
  - CORS: same-origin enforcement (localhost only), preflight `OPTIONS` handling.
  - CSP: 11-directive Content-Security-Policy + `X-Frame-Options: DENY` + `X-Content-Type-Options: nosniff` on every response.
  - Rate limiter: 30 req/min per IP on 12 sensitive routes (429 with `Retry-After`). New module: `chat/rate-limiter.js`.
- `9961ccb` — **Test framework:**
  - Node.js built-in `node:test` (zero new dependencies). `npm test` runs all tests.
  - `chat/test/security-policy.test.js` (20 tests) + `chat/test/rate-limiter.test.js` (6 tests). **26 pass, 0 fail.**

### SSOT updates
- Closed `mvp-factory-control#199` as Done with full completion comment.
- Created 9 new audit issues in `mvp-factory-control` (#211–#219), all added to Project Board 1.
- ⚠️ **Board fields (Product/Type/Priority/Status) for #211–#219 were NOT set** — the `gh project item-edit` CLI hung due to GitHub API rate limiting. Next agent must set these fields manually via the board UI or retry the CLI after the rate limit resets.

### Verification state
- `node chat/security-audit.js` → `critical=0 warn=0 info=5` ✅
- `npm test` → 26 pass, 0 fail ✅
- CORS blocking confirmed via curl ✅
- Security headers confirmed on all responses ✅

## Current Status / Known Issues (SSOT)
- `mvp-factory-control#196` — WhatsApp Desktop send still flaky (UI automation). Status: In Progress.
- `mvp-factory-control#197` — `/api/conversations` runs in `meta.mode = fallback`; server-side `q=` filtering disabled. WIP branch `codex/wip-conversations-index` (commit `788e3f3`) exists. Status: In Progress.
- `mvp-factory-control#202` — Omnichannel routing + NBA orchestration. Status: In Progress.
- `mvp-factory-control#211` — Decompose `server.js` into route modules. Status: Backlog. **Recommended next P1 task.**
- `mvp-factory-control#212` — CI pipeline (GitHub Actions). Status: Backlog. **Quick win — do before #211.**
- `mvp-factory-control#213` — Parameterized SQL. Status: Backlog.
- `mvp-factory-control#214–#219` — UX + business value items. Status: Backlog.
- ⚠️ Board fields for #211–#219 not yet set (rate limit issue). Set via https://github.com/users/moldovancsaba/projects/1

## Quick Verification (dev)
- Security baseline: `cd /Users/moldovancsaba/Projects/reply && node chat/security-audit.js`
- Tests: `cd /Users/moldovancsaba/Projects/reply/chat && npm test`
- Lint: `cd /Users/moldovancsaba/Projects/reply/chat && npm run lint`
- Channel bridge CLI: `node chat/channel-bridge-sidecar.js --event '{"channel":"telegram","peer":{"handle":"@qa"},"text":"hello"}' --dry-run`
- Contacts list: `GET /api/conversations?offset=0&limit=10` → expects `meta.mode = fallback` until #197 done.
- WhatsApp send (safe): `POST /api/send-whatsapp` with `{"recipient":"+3670...","text":"...","dryRun":true}`

## Next Agent Recommendations (priority order)
1. **Set board fields for #211–#219** — visit https://github.com/users/moldovancsaba/projects/1 and set Product=reply, Type, Priority, Status=Backlog for each.
2. **Add CI pipeline** (`mvp-factory-control#212`) — create `.github/workflows/ci.yml` running `npm run lint` + `npm test` on push/PR. Fast win, ~30 min.
3. **Parameterized SQL** (`mvp-factory-control#213`) — grep for string-interpolated SQL in `server.js` WhatsApp ID resolution and replace with `?` placeholders.
4. **Decompose server.js** (`mvp-factory-control#211`) — biggest refactor. Do #212 + #213 first so CI catches regressions.
5. **Rotate secrets** — `GOOGLE_API_KEY` and `REPLY_OPERATOR_TOKEN` were committed in Git history. Must be rotated.

## Active Session Update (2026-02-19, OpenClaw WhatsApp integration pattern)
- Added reusable case study doc: `docs/CHANNEL_INTEGRATION_CASE_STUDY.md`.
- Wired OpenClaw WhatsApp guard into runtime in `chat/server.js`:
  - applied once at startup
  - re-applied before each `openclaw_cli` WhatsApp send
- Guard behavior (`chat/openclaw-guard.js`):
  - forces `dmPolicy=disabled` (global + default account)
  - forces `groupPolicy=allowlist` (global + default account)
  - empties `~/.openclaw/credentials/whatsapp-allowFrom.json`
- Made env loading deterministic: `chat/server.js` now loads `chat/.env` via `__dirname`.
- Updated UI WhatsApp send payload in `chat/js/api.js`:
  - always sends `trigger: { kind: "human_enter", at: ... }`
  - enforces `transport: "openclaw_cli"` and `allowDesktopFallback=false` for WhatsApp sends.
- Updated default config in `chat/.env` and `chat/.env.example` to OpenClaw send mode.
- Validations run:
  - `node chat/security-audit.js` => `critical=0 warn=0`
  - `node chat/security-audit.js --fix` => `critical=0 warn=0`
  - `node --check chat/server.js` => pass
  - API policy check:
    - missing trigger => `403 human_enter_trigger_required`

## Active Session Update (2026-02-19, LinkedIn Bridge & Robustness)
- **LinkedIn Inbound:**
  - **Chrome Extension (Recommended):** Created `chat/chrome-extension/`. Connects to local server to sync LinkedIn messages.
  - **Port Failover:** Extension now scans ports `3000, 3001, 3002, 3003` to find the active server.
  - **UserScript (Alternative):** `js/linkedin-bridge.user.js` updated with same port failover logic.
  - **Manual Script Removed:** Removed embedded script from `dashboard.js` to prevent syntax crashes and encourage extension use.
- **Dashboard Stability:**
  - Fixed `dashboard.js` crash caused by unescaped template literals in the embedded script string.
  - Removed "Copy Script" button; manual ingestion now purely via Extension/UserScript.
- **SSOT:**
  - Work tracks against `mvp-factory-control#220` ({reply}: LinkedIn channel enablement).

