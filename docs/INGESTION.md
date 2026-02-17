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
*   **Command:** UI Button "Sync Notes" (at `http://localhost:3000`) or `node chat/sync-notes.js`.
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

---

## Configuration

| Env Variable | Description | Default |
| :--- | :--- | :--- |
| `REPLY_LANCEDB_URI` | Path to the Vector DB | `knowledge/lancedb` |
| `REPLY_KNOWLEDGE_PATH` | Path for local text docs | `knowledge/documents` |
| `PORT` | Chat Server Port | `3000` |
