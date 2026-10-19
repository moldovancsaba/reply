# Reply Core Data Model

Status: living document, owned by issue #184. Extended by Identity (#189, migration `0003`), Contacts (#192), Apple Mail (#193), Handoff (#203), Backup (#197). Migration numbers are assigned in merge order (`0002` is `sync_runs`).

One SQLite file, `core.db`, in `REPLY_CORE_HOME` (default `~/Library/Application Support/reply-core`). Mode `0600` inside a `0700` directory. WAL mode, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`. The database is a rebuildable cache of the source apps, except for the user's manual identity decisions (`merge_log`, manual links).

## Tables

| Table | Purpose |
|---|---|
| `messages` | One row per message from any channel (`meta_json` holds channel-specific details such as the iMessage service, a group message's sender, or an email's recipients and `isSummary` flag; migration `0004_message_meta.sql`). `id = channel:account:provider_message_key`, so re-ingest is idempotent. `ts_ms` is UTC epoch milliseconds. Text is capped at 256 KB. |
| `handles` | Every counterpart identifier seen (`handle_norm`), with `kind` (`phone`, `email`, `whatsapp`, `other`) and first/last seen. |
| `contacts` | A person. `origin` is `auto` (single-handle, created on first sight), `apple_contacts`, or `manual`. `external_id` is the address-book identifier; `merged_into` is set (with `hidden = 1`) when the contact was merged away (migration `0003_identity.sql`). `fingerprint` is the hash of an address-book person's name and handles at the last import (migration `0005_contact_fingerprint.sql`). |
| `contact_handles` | Maps each handle to exactly one contact. `link_origin` is `auto`, `apple_contacts`, or `manual_merge`. |
| `merge_log` | Append-only audit of merges and unmerges (never message content). `handles_json` is `[{ handle_norm, prior_origin }]`; an undone merge carries `reverted_by`. See [CORE_IDENTITY.md](CORE_IDENTITY.md). |
| `contact_summary` | Materialized per-contact list row: last message time/channel/preview, counts per channel. Rebuilt in the same transaction as every message batch. |
| `sync_state` | Per `(connector, account)` cursor, state (`idle`, `running`, `error`, `blocked`), last success/error, message total. |
| `handoffs` | One row per reply handed off to another app: time, contact, channel, kind of address, text length. Never the text (migration `0006_handoffs.sql`). |
| `sync_runs` | Last 50 runs per connector: outcome, attempts, pages, inserted/updated/skipped/quarantined, error code (migration `0002_sync_runs.sql`). |
| `messages_fts` | FTS5 index over `text` and `subject` (`unicode61 remove_diacritics 2`), kept in sync by triggers. |
| `schema_migrations` | Applied migrations with SHA-256 checksums. |

## Invariants

1. Every handle has exactly one contact (`contact_handles.handle_norm` is the primary key). Every message therefore belongs to exactly one contact.
2. A batch is one transaction. A structurally invalid row (unknown channel, empty handle, missing key) rolls the whole batch back. Rows with a timestamp `<= 0` or more than one day in the future are skipped and counted as `quarantined`.
3. `contact_summary` always reflects the latest message and per-channel counts of the contact's handles after any `upsertMessages`.
4. Merge and unmerge are explicit user actions only; nothing in storage links handles heuristically.

## Migrations

Files `core/src/storage/migrations/NNNN_name.sql`, forward-only, each applied in a transaction and recorded with its checksum. Editing an applied migration aborts start (`migration_checksum_mismatch`); fix forward with a new numbered file. Before applying pending migrations to an existing database, the runner copies it to `core.db.bak-<previous version>` and keeps the last three copies.

## Startup failures

`openDb` throws `storage_unavailable`, `storage_corrupt` (failed `quick_check` or not a database) or `storage_migration_failed`. The service exits with code 74 and a one-line message. Recovery: restore a backup, or delete `core.db` and let connectors re-ingest (manual merges are lost in that case; see the Backup and rebuild issue for the preserving path).

## Module interface

`openDb(home) -> { db, file }`; `createRepo(db) -> { upsertMessages, getThread, listContacts, search, getSyncState, setSyncState, rebuildSummary, ensureContactForHandle, handlesOf }`. HTTP routes over these are specified in the Read API issue (#194); cursors there are opaque encodings of the `(ts, id)` keyset used here.

`NormalizedMessage`: `{ channel, account, providerMessageKey, threadKey, handle_norm, isFromMe, tsMs, subject?, text, attachments }`.

## Inspecting a database

```bash
REPLY_CORE_HOME=/path/to/home node core/scripts/db-inspect.js
```

Prints schema version, `quick_check`, row counts and per-channel counts (read-only).

## Known limitations

- Deletions at the source are not propagated.
- No encryption at rest beyond FileVault.
