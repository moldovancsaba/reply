# Reply — Release Notes

Completed work only. The [GitHub Project Board](https://github.com/users/moldovancsaba/projects/1) is the source of truth for delivered items.

## 2026-02-17 — System Recovery & Maintenance
*   **Fix: Context Engine Syntax (#181):** Resolved a `SyntaxError` in `context-engine.js` caused by a duplicate `getSnippets` declaration that prevented server startup.
*   **Maintenance: Service Recovery:** Restored the `watch-imessage.js` background process for proactive drafting.
*   **Documentation:** Updated system architecture to formally include background processes.

---
- **Unified Background Worker**: Implemented a SQLite-based monitoring service (`background-worker.js`) that replaces older watchers.
- **macOS Startup Integration**: Added `launchd` support via `com.reply.worker.plist` for "always-on" background intelligence.
- **Improved KYC & Drafting**: Background processes are now consolidated and throttled for high efficiency.

## 2026-02-16 — Hybrid Search & Apple Notes Integration
*   **Feature: Hybrid Search (#172):** Implemented combined Semantic (Vector) and Lexical (Keyword) search using LanceDB for 100% retrieval accuracy.
*   **Feature: Apple Notes Sync (#163):** Added "Sync Notes" button to propertly ingest macOS Apple Notes with delta-sync capabilities.
*   **Feature: Scalable Ingestion (#171):** Added streaming support for large Mbox (Gmail export) files.
*   **Verification:** All features verified with automated tests and UAT.

## 2026-02-16 — POC: Knowledge Ingestion (#162)
*   **Knowledge Model:** Migrated to LanceDB Vector Database.
*   **Embeddings:** Local embedding generation using `@xenova/transformers`.

## 2026-02-16 — POC: Localhost Chat UI (#154)
*   **UI:** Simple web interface for chatting with the local brain.
