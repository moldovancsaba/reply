# {reply} — Knowledge Ingestion

`{reply}` learns your context by ingesting your data into a local Vector Database (LanceDB).

---

## Knowledge Model

*   **Storage:** Local LanceDB instance at `~/Library/Application Support/reply/lancedb` (or configured via `REPLY_LANCEDB_URI` / `REPLY_KNOWLEDGE_DB_PATH`).
*   **Schema:** `{ id, source, path, text, vector }`.
*   **Search:** **Hybrid Search** (Vector Similarity + Full-Text Keyword Search) for maximum accuracy.
*   **Annotation (Ollama, local):** After text lands in LanceDB, `chat/annotation-agent.js` can attach **`tags`**, a one-line **`summary`**, and **`facts`** (JSON) to each row (`is_annotated`, `annotation_*` columns). **`assembleReplyContext`** (`context-engine.js`) injects that metadata into the LLM “facts” block; **`/api/suggest-reply`** also returns each snippet with optional `annotation_summary`, `annotation_tags`, and `annotation_facts` when the row is annotated (reply#37).

---

## Ollama annotation (reply#36 / reply#37)

**Recommended order:** `npm run ingest` (or your sync path) → **`npm run annotate`** (optional but improves suggest quality). The worker can annotate on a timer instead.

1. **Ingest first** (Notes, mail, iMessage, files, etc.) so rows exist in LanceDB.
2. **Annotate:** `cd chat && npm run annotate` **or** wait for the **background worker** (default: every **30 minutes**, first run ~90s after worker start).
3. **Models:** `REPLY_ANNOTATION_MODEL` overrides the Ollama model (see `chat/ollama-model.js`); cap batch size with `REPLY_ANNOTATION_LIMIT` (default `50`).
4. **Disable / tune:** set `REPLY_ANNOTATION_DISABLE=1` to turn off the worker sweep, or `REPLY_ANNOTATION_INTERVAL_MS` to change the period (`0` = disable sweep).

---

## Supported Sources

### 1. Local Files (Markdown/Text)
*   **Command:** `node chat/ingest.js`
*   **Behavior:** Scans `knowledge/documents` for `.md` and `.txt` files.
*   **Use case:** Engineering notes, project documentation.

### 2. Email Archives (Mbox)
*   **Command:** `node chat/ingest.js --mbox /path/to/archive.mbox`
*   **Behavior:** Streams large Mbox files (Gmail exports), parses emails, and vectors them in batches.
*   **Performance:** Capable of handling 100k+ emails with low memory usage.

### 3. Apple Notes (macOS)
*   **Command:** UI Button "Sync Notes" (in the Web UI) or `node chat/sync-notes.js`.
*   **Source Label:** `source: "apple-notes"`
*   **Schema:**
    ```json
    {
      "id": "apple-notes-<UUID>",
      "source": "apple-notes",
      "path": "Note Title",
      "text": "[Date] Note: Title... \n\n Body Content..."
    }
    ```
*   **Mechanism:** Uses `osascript` to query the Apple Notes app via AppleScript. This approach is read-only and respects the user's local permissions without needing direct database access.
*   **Delta Sync:** Tracks note modification dates in `~/Library/Application Support/reply/notes-metadata.json` (or `REPLY_DATA_HOME/notes-metadata.json`). Only notes with a newer modification date are re-processed.
*   **Config:** Requires no special environment variables. It automatically detects notes available to the currently logged-in macOS user (iCloud or "On My Mac").

### 4. Email Sync (Apple Mail or IMAP/Gmail)
*   **Command:** UI Button "Sync Email" (in the Web UI) or `node chat/sync-mail.js`.
*   **Mechanism (default):** Uses `osascript` to query Apple Mail via AppleScript (read-only).
*   **Mechanism (recommended):** Gmail OAuth connector (Gmail API) configured in the Settings page (gear icon).
*   **Alternative:** IMAP connector (supports Gmail via IMAP with an App Password) when `REPLY_IMAP_*` env vars are set (or configured in Settings).
*   **Background Worker:** Email sync runs automatically only when Gmail OAuth or IMAP is configured (to avoid triggering Apple Mail AppleScript unintentionally).
*   **Source Label:** `source: "IMAP"` (stored as email snippets with `path: mailto:<address>`).
*   **Delta Sync (IMAP):** Tracks last-seen UIDs per mailbox in `~/Library/Application Support/reply/imap_sync_state.json`.
*   **Delta Sync (Gmail):** Tracks Gmail `historyId` in `~/Library/Application Support/reply/gmail_sync_state.json`.
*   **Settings storage:** UI settings are stored locally in `~/Library/Application Support/reply/settings.json` (not encrypted).

### 5. iMessage (macOS)
*   **Mechanism:** `chat/sync-imessage.js` (batch) and `chat/background-worker.js` (live poll) read Apple Messages SQLite **`chat.db`** and vectorize text into LanceDB; unified history also flows through `message-store.js` where applicable.
*   **Default path:** `~/Library/Messages/chat.db` (override with `REPLY_IMESSAGE_DB_PATH` in `chat/.env`). Requires **Full Disk Access** (or equivalent) for the process running Node — see [LOCAL_MACHINE_DEPLOYMENT.md](LOCAL_MACHINE_DEPLOYMENT.md).
*   **Resilience:** The hub does not exit if `chat.db` is missing or cannot be opened; iMessage sync/polling is skipped until access is fixed.

### 6. LinkedIn (browser → channel bridge)
*   **Purpose:** While logged into LinkedIn messaging in the browser, scrape visible thread snippets and `POST` them to the local hub as normalized bridge events (`channel: linkedin`).
*   **Chrome:** Unpacked extension — `chat/chrome-extension/content.js` (load the folder in `chrome://extensions` → Developer mode → Load unpacked).
*   **Userscript:** Tampermonkey (or compatible) — install `chat/js/linkedin-bridge.user.js`.
*   **Port discovery (reply#30):** Both paths probe `http://localhost:<port>/api/channel-bridge/inbound` over **`45311`–`45326` first** (default hub `PORT` and common shifts), then legacy dev ports **`3000`–`3003`**. The canonical list is implemented in `chat/linkedin-hub-port-scan.js` (Node tests); browser copies **must stay in sync** with that file’s numeric range.
*   **Failure UX:** If no port responds, the extension/userscript shows a toast listing the scan summary (check hub is running and `PORT` in `chat/.env`).
*   **Auth:** Inbound bridge may require operator token / local policy — see [CHANNEL_BRIDGE.md](CHANNEL_BRIDGE.md) and [HUMAN_FINAL_DECISION_POLICY.md](HUMAN_FINAL_DECISION_POLICY.md).

---

## Configuration

| Env Variable | Description | Default |
| :--- | :--- | :--- |
| `REPLY_LANCEDB_URI` | Path to the Vector DB | `~/Library/Application Support/reply/lancedb` |
| `REPLY_KNOWLEDGE_PATH` | Path for local text docs | `knowledge/documents` |
| `PORT` | Chat server port | `45311` |
| `REPLY_IMESSAGE_DB_PATH` | Absolute path to Apple Messages `chat.db` (optional) | macOS: `~/Library/Messages/chat.db` |
| `REPLY_IMAP_HOST` | IMAP host (enables IMAP mail sync) | (unset) |
| `REPLY_IMAP_PORT` | IMAP port | `993` |
| `REPLY_IMAP_SECURE` | Use TLS for IMAP | `true` |
| `REPLY_IMAP_USER` | IMAP username (usually email) | (unset) |
| `REPLY_IMAP_PASS` | IMAP password (Gmail: App Password) | (unset) |
| `REPLY_IMAP_MAILBOX` | Mailbox to sync (inbox) | `INBOX` |
| `REPLY_IMAP_SENT_MAILBOX` | Optional sent mailbox to sync | (unset) |
| `REPLY_IMAP_LIMIT` | Max emails fetched per mailbox per run | `200` |
| `REPLY_IMAP_SINCE_DAYS` | First-run lookback window (days) | `30` |
| `REPLY_SELF_EMAILS` | Comma-separated “my” emails for direction detection | `REPLY_IMAP_USER` |
