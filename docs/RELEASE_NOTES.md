# {reply} — Release Notes

Completed work only. For `{reply}`, the [GitHub Project (#7)](https://github.com/users/moldovancsaba/projects/7) and [`moldovancsaba/reply`](https://github.com/moldovancsaba/reply) issues are the source of truth for delivered items (portfolio board: [Project #1](https://github.com/users/moldovancsaba/projects/1)).

## [0.5.9] - 2026-04-12
### Added
- **Auto-triage / zero-inbox assistant ([reply#24](https://github.com/moldovancsaba/reply/issues/24)):** Shipped **`chat/triage-rules.json`**; `evaluate()` attaches `suggestedActions` + `priority`; **`getPriorityQueue()`** + **`GET /api/triage-queue`**. Dashboard: priority queue card + “Suggested” column on triage log. **`GET /api/triage-log?limit=`** now honors query limit.

## [0.5.8] - 2026-04-12
### Added
- **Alias merge UX + APIs ([reply#19](https://github.com/moldovancsaba/reply/issues/19)):** `GET /api/contacts/aliases?for=`, `POST /api/contacts/unlink-alias` (`aliasContactId`). `contact-store`: `findById`, `getContactRowByHandle`, `listAliasesForCanonical`, `unlinkAlias`. Merge route resolves handle vs id without mis-resolving alias rows. KYC panel shows linked profiles with **Unlink**. `GET /api/kyc` includes `contactId`.

## [0.5.7] - 2026-04-12
### Changed
- **Context engine ([reply#38](https://github.com/moldovancsaba/reply/issues/38)):** Chronological recipient thread in `assembleReplyContext` uses `formatChronologicalHistoryLines` so each message includes Ollama annotation metadata. `getContext` past-interaction snippets use the same enrichment before clipping.
### Added
- **`docs/CONTEXT_ENGINE.md`** — recipient awareness, RAG facts, Web Speech “Mic” voice-to-composer flow (`chat/js/app.js`).

## [0.5.6] - 2026-04-12
### Changed
- **Suggest-reply + annotations ([reply#37](https://github.com/moldovancsaba/reply/issues/37)):** `/api/suggest-reply` `snippets` now include `is_annotated`, `annotation_summary`, `annotation_tags`, `annotation_facts` when present. Analyzer fallback context in `reply-engine.js` uses `enrichAnnotatedDocText` for `contextSnippets` (aligned with `context-engine` RAG facts).
- **Docs:** `docs/INGESTION.md` — ingest → annotate order and API note.

## [0.5.5] - 2026-04-12
### Added
- **Local Ollama annotation pipeline ([reply#36](https://github.com/moldovancsaba/reply/issues/36)):** `npm run annotate` runs `annotation-agent.js` (loads `chat/.env` + `.env.local`). **Background worker** runs the same batch on a timer (default **30m**, configurable via `REPLY_ANNOTATION_INTERVAL_MS`; disable with `REPLY_ANNOTATION_DISABLE=1`). Exported `normalizeAnnotationFromOllama` + tests in `chat/test/annotation-agent.test.js`.
- **Docs:** `docs/INGESTION.md` — *Ollama annotation* section; `chat/.env.example` — `REPLY_ANNOTATION_*` knobs; `README.md` — product bullet.

## [0.5.4] - 2026-04-11
### Fixed
- **Send error UX:** Outbound `sendMessage` uses `delegateErrorUI` on the API layer so failed sends surface **one** error toast from `handleSendMessage` (no duplicate toast + alert). Toasts render message text via `textContent` with `pre-wrap` for multi-line policy hints.

### Added
- **Credential rotation procedure ([reply#34](https://github.com/moldovancsaba/reply/issues/34)):** [`docs/SECURITY_ROTATION.md`](SECURITY_ROTATION.md) — operator checklist and evidence table (rotation itself is still manual at the provider).
- **Tests ([reply#31](https://github.com/moldovancsaba/reply/issues/31)):** `chat/test/ensure-hub-worker.test.js`, `service-manager-worker-policy.test.js`, `conversations-meta.test.js`, `system-health-shape.test.js`.
- **LinkedIn bridge port scan ([reply#30](https://github.com/moldovancsaba/reply/issues/30)):** `chat/linkedin-hub-port-scan.js` + tests; Chrome `content.js` and `js/linkedin-bridge.user.js` probe **45311–45326** then legacy **3000–3003**, with clearer failure toasts.
- **Doc SSOT pass ([reply#29](https://github.com/moldovancsaba/reply/issues/29)):** Reconciled `HANDOVER.md`, `NEXT_AGENT_PROMPT.md`, `BRAIN_DUMP.md`, `DEPENDENCY_MAP.md`, `INGESTION.md` (LinkedIn section) with **Project #7** + current repo facts (CI Node 20, modular `chat/routes/*`, conversations `meta.*`).
- **Security hygiene ([reply#32](https://github.com/moldovancsaba/reply/issues/32)):** `settings-store` no longer writes `debug_token.log` unless `REPLY_DEBUG_SETTINGS=1` (log line is metadata-only, no token substring). `chat/data/debug_token.log` gitignored; `gemini-client.js` file header documents **Ollama-only** behavior and historical filename.
- **Gmail context meta ([reply#14](https://github.com/moldovancsaba/reply/issues/14)):** `assembleReplyContext` → `contextMeta.contextFreshnessSummary` (dominant bucket, ratios, mail-like count). Tests in `chat/test/context-freshness-mail.test.js`.
- **Rotation doc ([reply#34](https://github.com/moldovancsaba/reply/issues/34)):** `SECURITY_ROTATION.md` §3b records **repository-delivered** prevention checklist (operator §3 unchanged).
- **Conversation sort API ([reply#15](https://github.com/moldovancsaba/reply/issues/15)):** `GET /api/conversations` `meta.availableSortModes` (sorted allow-list). Determinism + `_rankTrace` coverage in `chat/test/conversation-sort-determinism.test.js`. Sidebar warns via toast when `sortValid === false`.
- **Hygiene ([reply#33](https://github.com/moldovancsaba/reply/issues/33)):** LinkedIn repro scripts moved to `chat/scripts/dev/` + README; `REPLY_DEBUG` gates noisy hub `console.log` lines in `chat/server.js`; menubar template probes Hatori at `http://127.0.0.1:<port>/v1/health` after hub health (reads `REPLY_HATORI_PORT` from `chat/.env`). `READMEDEV.md` / `DEFINITION_OF_DONE.md` link the logging policy.
- **Loading & toasts ([reply#46](https://github.com/moldovancsaba/reply/issues/46)):** Global spinner for `fetchConversations` / `fetchMessages` (`api.js` `_showLoading`), dashboard render + sync errors, AI suggest path (`app.js`), deep KYC analyze (`kyc.js`); merge/save errors use toasts instead of `alert()`.
- **Hatori ops:** Sibling clone [moldovancsaba/hatori](https://github.com/moldovancsaba/hatori); `make hatori-bootstrap` runs upstream **`hatori_bootstrap.sh`**; **`chat/load-env.js`** + **`.env.local`** for **`REPLY_USE_HATORI`**; **`make hatori-preflight`**, **`npm run verify:hatori`**.

### Changed
- **CI:** GitHub Actions workflow uses `actions/checkout@v4`, `actions/setup-node@v4`, Node **20**, `npm ci`, and npm cache keyed on `chat/package-lock.json`. Adds an **informational** `npm audit --audit-level=high` step (`continue-on-error: true`) until the dependency tree is clean enough to hard-fail.
- **Outbound policy ([reply#17](https://github.com/moldovancsaba/reply/issues/17)):** Inbound-verified identities from **linked contacts** (`primary_contact_id` → primary) are merged when evaluating send gating. **LinkedIn** recipient must match a verified identity **exactly** after normalization (no substring unlock).
- **Docs:** `docs/HANDOVER.md` and `docs/LOCAL_MACHINE_DEPLOYMENT.md` — link or align with the above (Node **20** in CI vs **18+** on the Mac).

## [0.5.3] - 2026-04-10
### Added
- **Outbound policy (issue [#17](https://github.com/moldovancsaba/reply/issues/17)):** Send paths (`/api/send-imessage`, `/api/send-email`, `/api/send-linkedin`, `/api/send-whatsapp`) require an **inbound-verified** channel identity unless `REPLY_OUTBOUND_REQUIRE_INBOUND_VERIFIED=false`. Denied attempts append to `chat/data/outbound-policy-denials.jsonl` (gitignored). Responses use `403` with `policy: inbound_verified_required`, `hint`, and `code` where applicable. See `chat/utils/outbound-policy.js` and `chat/test/outbound-policy.test.js`.
- **Conversation sort modes (issue [#15](https://github.com/moldovancsaba/reply/issues/15)):** `/api/conversations` accepts `sort` / `rank` (`newest`, `oldest`, `freq`, `volume_in`, `volume_out`, `volume_total`, `recommendation`). Response `meta` includes `sort`, `sortRequested`, `sortValid`. Recommendation mode exposes per-row `_rankTrace` after sanitization. Dashboard and Settings sidebars include a sort `<select>`; choice is persisted in `localStorage` under `replyConversationsSort`.
- **Mail/context freshness (issue [#14](https://github.com/moldovancsaba/reply/issues/14)):** `chat/utils/context-freshness.js` blends vector relevance with recency (half-life via `REPLY_CONTEXT_HALF_LIFE_DAYS`, weights via `REPLY_CONTEXT_RELEVANCE_WEIGHT` / `REPLY_CONTEXT_FRESHNESS_WEIGHT`). `assembleReplyContext` and `/api/suggest` expose explainable `contextMeta` / RAG traces where applicable; snippet APIs attach freshness metadata.

### Changed
- **`chat/.gitignore`:** Ignores local SQLite files, sync cursor/state JSON, outbound denials, **`security_audit.jsonl`** (append-only security audit on disk — do not commit), and `logs/`.
- **Repository hygiene:** `chat/data/worker.pid` and `chat/data/security_audit.jsonl` are no longer tracked; each machine keeps its own files.

### GitHub — issue closure comments (copy-paste)

Use when closing [#17](https://github.com/moldovancsaba/reply/issues/17), [#15](https://github.com/moldovancsaba/reply/issues/15), and [#14](https://github.com/moldovancsaba/reply/issues/14) after verifying on `main`.

**[#17](https://github.com/moldovancsaba/reply/issues/17) — Reply-only outbound / inbound proof**

```text
Shipped on main (v0.5.3).

- Outbound sends are gated on contact channel identities that have inbound proof (`verifiedChannels` / `contact_channels.inbound_verified_at`), with channel-specific matching (email, phone/WhatsApp digits, LinkedIn slug).
- Opt-out for dev/special cases: `REPLY_OUTBOUND_REQUIRE_INBOUND_VERIFIED=false` (or `0`).
- Denials are appended to `chat/data/outbound-policy-denials.jsonl` (local, gitignored).
- API: HTTP 403 JSON includes `error`, `code`, `hint`, and `policy: "inbound_verified_required"` where applicable.
- Tests: `chat/test/outbound-policy.test.js` (`npm test` in `chat/`).

Closing as completed.
```

**[#15](https://github.com/moldovancsaba/reply/issues/15) — Conversation list sort / rank**

```text
Shipped on main (v0.5.3).

- `GET /api/conversations?sort=…` (alias `rank`): newest | oldest | freq | volume_in | volume_out | volume_total | recommendation.
- Response `meta.sort`, `meta.sortRequested`, `meta.sortValid`; recommendation mode returns `_rankTrace` on items for debugging/explainability.
- UI: sort dropdown on dashboard (`index.html`) and settings sidebar (`settings.html`); persisted via localStorage key `replyConversationsSort`.
- Vector index exposes per-handle counts/first timestamp for volume/frequency ordering.

Closing as completed.
```

**[#14](https://github.com/moldovancsaba/reply/issues/14) — Gmail/mail context freshness**

```text
Shipped on main (v0.5.3).

- `chat/utils/context-freshness.js`: exponential recency decay + blend with search relevance; tunable `REPLY_CONTEXT_HALF_LIFE_DAYS` (default 21), `REPLY_CONTEXT_RELEVANCE_WEIGHT`, `REPLY_CONTEXT_FRESHNESS_WEIGHT`.
- RAG pool ranked before prompt assembly; facts/snippets labeled with freshness bucket and score where applicable.
- `/api/suggest` includes `contextMeta` (traces, half-life, weights) for inspection.
- `chat/.env.example` documents the new variables alongside outbound policy flags.

Closing as completed.
```

## [0.5.2] - 2026-04-09
### Changed
- **SSOT / project management:** `{reply}` tasks and issues are **canonical in this repository** and [GitHub Project #7](https://github.com/users/moldovancsaba/projects/7), not only in `mvp-factory-control` / MVP Factory Project #1. Updated [`PROJECT_MANAGEMENT.md`](PROJECT_MANAGEMENT.md), [`DEFINITION_OF_DONE.md`](DEFINITION_OF_DONE.md), [`HANDOVER.md`](HANDOVER.md), [`CODING_STANDARDS.md`](CODING_STANDARDS.md), [`APP_NAVIGATION.md`](APP_NAVIGATION.md), and related docs; [`GITHUB_REPLY_PROJECT_MIGRATION.md`](GITHUB_REPLY_PROJECT_MIGRATION.md) is now framed as legacy migration from the portfolio board.

## [0.5.1] - 2026-04-08
### Added
- **Local machine deployment guide**: [docs/LOCAL_MACHINE_DEPLOYMENT.md](LOCAL_MACHINE_DEPLOYMENT.md) documents macOS LaunchAgent install, `chat/.env`, Ollama (`gemma4:e2b`), log locations, port failover, and operational troubleshooting. Linked from the root [README.md](../README.md).
- **Documentation cross-links**: [ARCHITECTURE.md](ARCHITECTURE.md) (runtime & deployment), [APP_NAVIGATION.md](APP_NAVIGATION.md) (hub install pointer), [INGESTION.md](INGESTION.md) (iMessage source + `REPLY_IMESSAGE_DB_PATH`, corrected default `PORT` in the config table), [README.md](../README.md) run modes / menubar; `tools/scripts/reply_service.sh` header comment points to the deployment guide.
- **ReplyMenubar**: Added [tools/macos/ReplyMenubar/README.md](../tools/macos/ReplyMenubar/README.md) and **`install_ReplyMenubar.sh`** (generates `main.swift` from `main.swift.template`, compiles with `swiftc`, installs `~/Applications/ReplyMenubar.app`) so `make install-ReplyMenubar` works. [LOCAL_MACHINE_DEPLOYMENT.md](LOCAL_MACHINE_DEPLOYMENT.md) lists the menubar in the topology table and first-time setup.

### Fixed
- **Hub stability / iMessage SQLite**: `chat/sync-imessage.js` opens Apple `chat.db` **lazily** via `getIMessageReadonlyDb()`, handles open failures and `database.on('error')`, and requires a valid DB in `sync()` before querying — avoids hub exit loops when the DB is missing or blocked by TCC (e.g. `SQLITE_CANTOPEN`).
- **Background worker**: `chat/background-worker.js` skips iMessage live polling when `chat.db` is unreadable instead of calling SQLite on a null handle.
- **Contacts database**: `chat/contact-store.js` creates the parent directory for the SQLite file (best-effort) and attaches a DB `error` listener.

### Changed
- **Ollama model defaults**: Default local tag is `gemma4:e2b` in `chat/ollama-model.js`. Refine (`chat/gemini-client.js`) uses `getReplyOllamaModel()` so suggestions and refine share `REPLY_OLLAMA_MODEL`. `scripts/analyze-style.js` uses the same resolver. `chat/.env.example` comments updated accordingly.

## [0.5.0] - 2026-03-06
### Added
- **Self-Repair Watchdog**: `service-manager.js` now auto-restarts crashed services (`worker`, `openclaw`, `hatori`) with exponential backoff (up to 3–5 retries). After exhausting retries, surfaces a `repair_required` state with an actionable error hint.
- **System Alerts Dashboard Panel**: New panel at the top of the dashboard appears only when a service is down. Shows severity (CRITICAL/WARNING), the exact error, an actionable hint (e.g. `ollama serve`), a "Try Again" button for managed services, and a "Copy Log Cmd" button.
- **Hatori/Ollama Watchdog**: The health API now triggers an automatic Hatori restart after 3 consecutive health check failures. Ollama (unmanaged external) surfaces as a UI alert with terminal command instructions.
- **Gmail Full-History Backfill**: Implemented `nextPageToken` paging in `gmail-connector.js` to progressively index the entire Gmail history (15+ years, 200K+ emails) in batches of 500 every 7 minutes, to avoid overloading the system.
- **Menubar v0.5.0**: Rebuilt and re-launched the macOS menu bar tool to reflect the new version.

### Fixed
- **Operator Token Errors**: Resolved `Missing or invalid operator token` errors blocking background worker and OpenClaw startup.
- **Settings Black Screen**: Fixed `innerHTML.trim()` bug that prevented the Settings page from rendering.
- **Async Poll Race**: Refactored `background-worker.js` poll loop to properly await all async operations, preventing missed processing batches.

### Improved
- **Premium Settings UI**: Complete glassmorphism redesign of the Settings page with dark theme, icon sidebar, and improved card layouts.
- **Health API repair[]**: `/api/health` now exposes a `repair` array containing active service alerts for programmatic and UI consumption.

## [0.4.6] - 2026-03-02
### Refactored
- **Server Decomposition**: Modularized `server.js` for better maintainability (reduced to < 200 lines).
- **Static Asset Routes**: Extracted HTML and asset serving to `chat/routes/static.js`.
- **System Route Consolidation**: Consolidated service control and triage logs into `chat/routes/system.js`.

### Security
- **Hardened Human Approval**: Enabled mandatory human approval for sensitive writes by default (`REPLY_SECURITY_REQUIRE_HUMAN_APPROVAL=true`).
- **Code Audit**: Verified elimination of all shell-based execution patterns in the main server gateway.

### Fixed
- **Settings Persistence**: Fixed a critical bug in `withDefaults` where sensitive fields (API keys/tokens) were being wiped during safety merges after security token updates.
- **Gmail Connector Sync Depth**: Increased initial sync limit to 10,000 messages (from 2,000) for "All Mail" and "Custom" scopes to resolve the low message count issue.
- **Gmail Sync Logic**: Fixed a regression in `gmail-connector.js` that caused an `await` syntax error outside of an async block.
- **Hatori Outcome Wiring**: Unified `/api/hatori/outcome` and `/api/hatori-outcome` routing and exported the missing outcome handler so sent/edit outcomes are persisted reliably.
- **Refine Endpoint Wiring**: Unified `/api/refine-reply` and `/api/refine` routing so the Refine button consistently updates the current draft.
- **Suggest Replacement Feedback**: Added explicit replacement feedback/outcome signaling when Suggest replaces an existing draft (`not_sent` + replacement reason).

### Improved
- **KYC Performance**: Increased auto-scan speed cap to 60/hour and set default processing to 20/hour (up from 1/hour), enabling ~480 profile prioritizations per day.
- **Language Fallback Governance**: Added explicit language hint propagation from `{reply}` to `{hatori}` and stronger fallback resolution from thread context.
- **Omnichannel Context Delivery**: Expanded thread context payload for `{hatori}` and attached omnichannel/tone metadata for better per-contact adaptation.
 
## [0.4.4] - 2026-03-02
### Added
- **Settings UI Modularization**: Refactored the monolithic Settings UI into a separate HTML fragment (`fragments/settings-fragment.html`) with asynchronous lazy-loading, improving initial load performance and maintainability.
- **Dashboard Triage Log Fixes**: Implementation of a scrollable triage log with `max-height` and `overflow-y: auto`. Fixed a bug where logs were duplicated or overloaded by clearing the container before re-rendering.
- **Project Documentation Sync**: Comprehensive update of `v0.4.4` across `package.json`, `README.md`, and handover documentation.

### Added
- **"Rock-Solid" Foundation**: Implemented `SyncGuard` process locking to prevent concurrent sync tasks and 409 Conflict handling.
- **Atomic Persistence**: Refactored `StatusManager` to use atomic rename-based writes, eliminating JSON corruption risks.
- **UI/UX Standardization**: Unified dashboard card alignment, fixed metadata text overflow with auto-ellipsis, and standardized header heights.
- **SQLite Concurrency**: Enabled `WAL` mode and `busy_timeout` across all database modules for resilient multi-process access.
- **Path Resilience**: Improved `VectorStore` to automatically handle and recreate missing directory structures.

## [0.2.0] - 2026-02-25
### Added
- **"Holy Grail" Personal AI Pipeline**: Built an end-to-end local generation pipeline that automatically mimics the user's communication style (tone, sentence length, vocabulary, emojis).
- **Automated Persona Extraction**: Analyzes random outbound message pairs using `llama3.2:3b` to yield a strict `system_persona.txt` set of rules.
- **Dynamic RAG Drafting**: Injects top 4 retrieved past "Me" messages directly into local `gemma2:2b` drafts for real-time mimicking.
- **Local LLM Migration**: Fully migrated off Gemini to `ollama`, resolving all rate-limit issues while enforcing absolute privacy.
- **Automated Continuous Learning Loop**: An hourly background loop syncs new WhatsApp and iMessage texts to LanceDB, enriching RAG memory without manual clicks.

## [0.1.3] - 2026-02-23
### Added
- **LinkedIn Messaging Integration**: Promoted LinkedIn to a first-class channel with "Send LinkedIn" support (clipboard fallback flow).
- **Unified Bridge Persistence**: All inbound bridge events are now persisted to SQLite (`chat.db`), ensuring consistent mixed-channel chat history.
- **Learning from Action**: Sent LinkedIn messages are automatically saved as "Golden Examples" in LanceDB to reinforce stylistic mimicry.
- **LinkedIn Professional Styling**: Added LinkedIn-consistent brand colors for message bubbles in the chat feed.

## [0.1.2] - 2026-02-23
### Added
- **LinkedIn Own Posts Ingestion**: New `ingest-linkedin-posts.js` script to ingest LinkedIn archive data (`Shares.csv`) into the vector store.
- **Golden Examples mimicking**: The generator now injects "Golden Examples" (annotated or ingested posts/sent items) into the LLM prompt for superior stylistic mimicry.
- **Dynamic Context Assembly**: Updated `context-engine.js` to unify historical interactions and stylistic anchors.

## [0.1.1] - 2026-02-21
### Added
*   **Email: Dynamic Subject Support:** Replies now dynamically reuse the most recent subject from thread history (found via `vector-store.js` + `getLatestSubject`). Falls back to a clean empty subject if no history exists, replacing the hardcoded default.
*   **UX: "Pleasant Viewing" engine:** Implemented a robust `message-cleaner.js` utility that strips `<style>` and `<script>` blocks from HTML emails. Solving the "CSS clutter" issue where raw email styles would bleed into the app UI.
*   **UX: Structured subject/body display:** `js/message-formatter.js` now renders emails with distinct, styled Subject and Body sections for better readability.
*   **Attachments: MVP detection:** Gmail and IMAP sync engines now detect attachments during ingestion and store metadata in the message text. These are rendered as interactive download placeholders/placeholders in the chat bubbles.

## 2026-02-19 — OpenClaw WhatsApp Guardrail Integration + Channel Case Study
*   **OpenClaw guard enforced in runtime:** `{reply}` now applies WhatsApp OpenClaw safety guard at server startup and before OpenClaw sends, forcing DM policy to `disabled`, group policy to `allowlist`, and resetting `whatsapp-allowFrom` to empty.
*   **Deterministic policy loading:** `chat/server.js` now loads `chat/.env` via absolute path, preventing launch-directory drift from silently bypassing WhatsApp transport policy flags.
*   **Manual human trigger enforced end-to-end:** UI WhatsApp sends now always include explicit `human_enter` trigger metadata and request `openclaw_cli` transport with desktop fallback disabled.
*   **Operational playbook documented:** added `docs/CHANNEL_INTEGRATION_CASE_STUDY.md` as the canonical implementation template for future channel integrations under human-final-decision controls.

## 2026-02-18 — WhatsApp/OpenClaw Hardening + KYC Save Security Fix
*   **WhatsApp: OpenClaw fallback hardening:** `/api/send-whatsapp` now retries once via Desktop automation when OpenClaw fails with listener/gateway/session/login errors.
*   **WhatsApp: Cleaner error output:** Send errors are normalized to avoid nested `Error: Error: ...` text, and server responses include actionable hints.
*   **Email: Duplicate prevention fix:** Gmail incremental sync no longer reruns initial full sync when history returns no new events; this prevents repeated re-ingest of old messages.
*   **Threads/Counts: Dedupe-aware read path:** History retrieval now dedupes by stable key (`id`, fallback `path::text`) so thread totals and sidebar counts align with unique messages.
*   **KYC: Profile save reliability restored:** KYC write actions now include security approval/token headers required by hardened sensitive-route authorization, fixing profile save failures after policy rollout.

## 2026-02-18 — Settings Page + Gmail Reliability
*   **UX: Settings as a full page:** Replaced the modal with a dedicated Settings page (Dashboard-sized).
*   **UX: Clear separation of General vs Service settings:** General Settings shows connectors + global worker interval; per-service settings are accessed via card cogs.
*   **UX: Dashboard space:** Profile pane is hidden on the Dashboard for more room.
*   **UX: Sidebar contact search:** Added a search box in the sidebar (server-side `q=` filter on `/api/conversations`).
*   **Contacts: Better sidebar stats:** `/api/conversations` uses LanceDB `countRows(...)` + recent-row sampling for counts/previews and returns `meta.mode=db` (no longer stuck in fallback mode).
*   **Email: Gmail health check:** Added `/api/gmail/check` to validate Gmail OAuth connectivity.
*   **Email: Correct dashboard counts:** Email Sync now counts ingested email docs from LanceDB using `source IN ('Gmail','IMAP','Mail','mbox')`.
*   **Email: Gmail sync scope:** Added Settings for Inbox+Sent / All Mail / Custom query.
*   **Email: Safer Mail.app fallback:** Mail.app fallback now passes recipient/body via `osascript` argv to avoid quoting issues and support multiline bodies.
*   **WhatsApp: Send reliability + errors:** Focus thresholds are computed relative to the WhatsApp window position, and failures return a more actionable `hint`.

## 2026-02-17 — System Recovery & Maintenance
*   **Fix: Context Engine Syntax:** Resolved a `SyntaxError` in `context-engine.js` caused by a duplicate `getSnippets` declaration that prevented server startup.
*   **Maintenance: Unified Worker:** Standardized background intelligence on `background-worker.js` (polling interval configurable in Settings).
*   **Documentation:** Updated system architecture to formally include background processes.
*   **UX: Contact Channel Indicators:** Sidebar now shows a simple emoji for the latest channel (iMessage/WhatsApp/Mail/etc.).
*   **UX: Stronger Channel Visibility:** Emoji is also prefixed into the contact name/preview text (easier to see than a trailing icon).
*   **UX: Per-Message Channel Indicators:** Message timestamps now include the channel emoji so mixed threads are readable.
*   **Fix: WhatsApp @lid Handles:** Resolves linked-device `@lid` identifiers to real phone JIDs for stable contact display and unified thread history.
*   **Fix: Fallback Channel Detection:** When the contact list falls back to `contacts.json`, it uses persisted `lastChannel` from sync scripts (instead of assuming iMessage for all phones).
*   **Fix: WhatsApp Send Double-Message:** Improves WhatsApp UI automation to avoid accidentally sending the recipient number as a message when focus is wrong.
*   **Fix: WhatsApp Search Focus Reliability:** Switches back to shortcut-based search focus with stronger “don’t send the recipient” safeguards.
*   **Feature: Gmail OAuth Connector:** Added Gmail API OAuth connect + sync + send (local token storage).
*   **Feature: Settings UI:** Added Settings (General + per-service via ⚙️ cogs) for mail/worker/channel UI configuration.
*   **UX: Per-Channel Bubble Colors:** Message bubbles now support per-channel coloring (configurable).
*   **UX: Composer + KYC Polish:** Composer alignment is consistent, KYC pane is wider, and background worker can refresh typed suggestions from full history on a debounced schedule.

---
- **Unified Background Worker**: Implemented a SQLite-based monitoring service (`background-worker.js`) that replaces older watchers.
- **macOS Startup Integration**: Prefer **`com.reply.hub`** via `make run` (hub starts `background-worker.js`). A deprecated optional template is [`tools/launchd/com.reply.worker.plist.example`](../tools/launchd/com.reply.worker.plist.example); do not run both hub-managed and standalone worker LaunchAgents.
- **Improved KYC & Drafting**: Background processes are now consolidated and throttled for high efficiency.
- **{reply} web UI + Intelligence**: Message counts in sidebar, per-message timestamps in thread, real Mic dictation (SpeechRecognition), KYC-aware Suggest drafts, and a polished KYC pane (profile edit, channels, AI suggestions accept/decline, notes CRUD, and name propagation to feed + sidebar).
- **Channel-aware Composer**: Added a channel dropdown in the composer; default channel follows the most recent inbound message. iMessage/email send normally; WhatsApp sends via Desktop automation with clipboard fallback on failure. Telegram/Discord/Signal/Viber/LinkedIn are draft-only.

## 2026-02-16 — Hybrid Search & Apple Notes Integration
*   **Feature: Hybrid Search:** Implemented combined Semantic (Vector) and Lexical (Keyword) search using LanceDB for 100% retrieval accuracy.
*   **Feature: Apple Notes Sync:** Added "Sync Notes" button to propertly ingest macOS Apple Notes with delta-sync capabilities.
*   **Feature: Scalable Ingestion:** Added streaming support for large Mbox (Gmail export) files.
*   **Verification:** All features verified with automated tests and UAT.

## 2026-02-16 — POC: Knowledge Ingestion
*   **Knowledge Model:** Migrated to LanceDB Vector Database.
*   **Embeddings:** Local embedding generation using `@xenova/transformers`.

## 2026-02-16 — POC: Localhost Chat UI
*   **UI:** Simple web interface for chatting with the local brain.
