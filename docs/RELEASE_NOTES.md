# Reply — Release Notes

Completed work only. The [GitHub Project Board](https://github.com/users/moldovancsaba/projects/1) is the source of truth for delivered items.

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
*   **Feature: Settings UI:** Added Settings modal (global + per-channel via ⚙️ cogs) for mail/worker/channel UI configuration.
*   **UX: Per-Channel Bubble Colors:** Message bubbles now support per-channel coloring (configurable).
*   **UX: Composer + KYC Polish:** Composer alignment is consistent, KYC pane is wider, and background worker can refresh typed suggestions from full history on a debounced schedule.

---
- **Unified Background Worker**: Implemented a SQLite-based monitoring service (`background-worker.js`) that replaces older watchers.
- **macOS Startup Integration**: Added `launchd` support via `com.reply.worker.plist` for "always-on" background intelligence.
- **Improved KYC & Drafting**: Background processes are now consolidated and throttled for high efficiency.
- **{reply} web UI + Intelligence**: Message counts in sidebar, per-message timestamps in thread, real Mic dictation (SpeechRecognition), KYC-aware Suggest drafts, and a polished KYC pane (profile edit, channels, AI suggestions accept/decline, notes CRUD, and name propagation to feed + sidebar).
- **Channel-aware Composer**: Added a channel dropdown in the composer; default channel follows the most recent inbound message. iMessage/email can send; WhatsApp copies to clipboard as an interim.

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
