# Reply — Release Notes

Completed work only. The [GitHub Project Board](https://github.com/users/moldovancsaba/projects/1) is the source of truth for delivered items.
 
## [0.3.0] - 2026-02-26
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
- **macOS Startup Integration**: Added `launchd` support via `com.reply.worker.plist` for "always-on" background intelligence.
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
