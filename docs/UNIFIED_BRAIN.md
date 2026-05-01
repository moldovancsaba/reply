# {reply} — Unified brain (ingestion at scale) (reply#12)

**Goal:** Combine **email history**, **calendar context**, and **chat transcripts** into a single **stylistic + factual** model the local stack can query (LanceDB + Ollama).

## Current building blocks (already in repo)

| Layer | Location | Role |
| :--- | :--- | :--- |
| Mail / Sent | `chat/sync-mail.js`, `chat/sync-imap.js`, `chat/gmail-connector.js` | Vectorize threads into LanceDB |
| Chat | `chat/sync-imessage.js`, bridge workers | Same store |
| Style fingerprint | `knowledge/style-profile.json` (from sent-mail analysis) | `context-engine.js` + `reply-engine.js` tone |
| Annotation | `chat/annotation-agent.js`, worker sweep | Tags / summary / facts on rows |
| RAG + ranking | `chat/context-engine.js`, `chat/utils/context-freshness.js` | Recipient-aware prompts |

## CLI report

Run **`cd chat && npm run fingerprint`** to print a small JSON summary: whether a style profile exists and LanceDB URI (see `unified-brain-report.js`). Extend this script as you add calendar ingestion or aggregate stats.

## Roadmap (engineering)

1. **Calendar ingestion** — normalized events → LanceDB rows (`source: calendar`) with bracketed timestamps.
2. **Cross-source dedupe** — reuse `dedupeDocsByStableKey` patterns; stable keys per thread.
3. **Evaluation loop** — periodic refresh of `style-profile.json` after large mail imports.
4. **Scale** — batch sizes and `REPLY_*_LIMIT` envs (see [INGESTION.md](INGESTION.md)).
