# Reply — Knowledge Ingestion

Reply learns your context by ingesting your data into a local Vector Database (LanceDB).

---

## Knowledge Model

*   **Storage:** Local LanceDB instance at `knowledge/lancedb` (or configured via `REPLY_LANCEDB_URI`).
*   **Schema:** `{ id, source, path, text, vector }`.
*   **Search:** **Hybrid Search** (Vector Similarity + Full-Text Keyword Search) for maximum accuracy.

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
*   **Delta Sync:** Tracks note modification dates in `knowledge/notes-metadata.json`. Only notes with a newer modification date are re-processed.
*   **Config:** Requires no special environment variables. It automatically detects notes available to the currently logged-in macOS user (iCloud or "On My Mac").

### 4. Email Sync (Apple Mail or IMAP/Gmail)
*   **Command:** UI Button "Sync Email" (in the Web UI) or `node chat/sync-mail.js`.
*   **Mechanism (default):** Uses `osascript` to query Apple Mail via AppleScript (read-only).
*   **Mechanism (recommended):** Gmail OAuth connector (Gmail API) configured in the UI Settings (gear icon).
*   **Alternative:** IMAP connector (supports Gmail via IMAP with an App Password) when `REPLY_IMAP_*` env vars are set (or configured in Settings).
*   **Background Worker:** Email sync runs automatically only when Gmail OAuth or IMAP is configured (to avoid triggering Apple Mail AppleScript unintentionally).
*   **Source Label:** `source: "IMAP"` (stored as email snippets with `path: mailto:<address>`).
*   **Delta Sync (IMAP):** Tracks last-seen UIDs per mailbox in `chat/data/imap_sync_state.json`.
*   **Delta Sync (Gmail):** Tracks Gmail `historyId` in `chat/data/gmail_sync_state.json`.
*   **Settings storage:** UI Settings are stored locally in `chat/data/settings.json` (not encrypted).

---

## Configuration

| Env Variable | Description | Default |
| :--- | :--- | :--- |
| `REPLY_LANCEDB_URI` | Path to the Vector DB | `knowledge/lancedb` |
| `REPLY_KNOWLEDGE_PATH` | Path for local text docs | `knowledge/documents` |
| `PORT` | Chat Server Port | `3000` |
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
