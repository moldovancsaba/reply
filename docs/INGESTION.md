# Reply — Knowledge ingestion

How Reply learns "how I act" by ingesting your data. **POC:** one source (local files); more sources (Gmail, Drive, iCloud, Notes, calendar) later.

---

## Knowledge model (POC)

- **What we store:** Snippets of text with a source label and path. Each snippet is one piece of content (e.g. one file, or one paragraph) used to reflect your style and context.
- **Schema (in code):** `{ id, source, path, text }` — `source` is e.g. `"local"`, `path` is the file path or identifier, `text` is the content.
- **Storage:** Single JSON file at `knowledge/store.json` (configurable via `REPLY_KNOWLEDGE_STORE`). No database required for POC.
- **Query:** By keyword/substring: given a message, we return snippets whose `text` contains any of the message’s words (case-insensitive). Reply engine or UI can use these as context for suggestions.

Future: vector store or embeddings for semantic search; more sources (Gmail, Drive, iCloud, Notes, calendar) each producing snippets with `source` and `path`.

---

## First source: local files

- **Path:** Set `REPLY_KNOWLEDGE_PATH` to a folder; default is `./knowledge/documents` (relative to repo root or to the script).
- **Files:** We scan `.txt` and `.md` files, read their content, and add one snippet per file (path + full text). Subfolders are included.
- **Run ingestion:** From repo root, `node chat/ingest.js`. Or from `chat/`: `node ingest.js`. Writes to `knowledge/store.json` (create `knowledge/` if needed).
- **Secrets:** None for local files. For future Gmail/Drive, use env vars (e.g. `GMAIL_CREDENTIALS_PATH`) and keep them out of the repo.

---

## How to run (POC)

1. Put `.txt` or `.md` files in `knowledge/documents/` (or set `REPLY_KNOWLEDGE_PATH` to your folder). A sample file is in `knowledge/documents/sample.txt`.
2. Run ingestion: from repo root `node chat/ingest.js`, or from `chat/` run `npm run ingest` or `node ingest.js`. Writes to `knowledge/store.json`.
3. Start the chat: `cd chat && npm start`. Open http://localhost:3000. Suggest-reply returns `suggestion` and `snippets` (from your notes) when the message matches ingested text.

---

## Config / env

| Env | Meaning | Default |
|-----|--------|--------|
| `REPLY_KNOWLEDGE_PATH` | Folder to scan for .txt/.md | `./knowledge/documents` (from script dir: `../knowledge/documents` when run from `chat/`) |
| `REPLY_KNOWLEDGE_STORE` | Path to store JSON | `./knowledge/store.json` (from repo root) |

All paths can be absolute or relative. Do not commit `knowledge/store.json` if it contains sensitive data; add to `.gitignore` or use a path outside the repo.
