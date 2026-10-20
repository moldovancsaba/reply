# Reply Core Data Model

Status: living document. Migrations are `core/src/storage/migrations/0001`..`0012`, listed below.

One SQLite file, `core.db`, in `REPLY_CORE_HOME` (default `~/Library/Application Support/reply-core`). Mode `0600` inside a `0700` directory. WAL mode, `foreign_keys=ON`, `busy_timeout=5000`, `synchronous=NORMAL`. The database is a rebuildable cache of the source apps, except for user data that cannot be re-imported: manual merges (`merge_log`, manual links), `contact_profile`, `contact_notes`, `read_state`, and the audits `sends` and `handoffs`.

## Tables

| Table | Purpose |
|---|---|
| `messages` | One row per message from any channel (`meta_json` holds channel-specific details such as the iMessage service, a group message's sender, or an email's recipients and `isSummary` flag; migration `0004_message_meta.sql`). `id = channel:account:provider_message_key`, so re-ingest is idempotent. `ts_ms` is UTC epoch milliseconds. Text is capped at 256 KB. |
| `handles` | Every counterpart identifier seen (`handle_norm`), with `kind` (`phone`, `email`, `whatsapp`, `other`) and first/last seen. |
| `contacts` | A person. `origin` is `auto` (single-handle, created on first sight), `apple_contacts`, or `manual`. `external_id` is the address-book identifier; `merged_into` is set (with `hidden = 1`) when the contact was merged away (migration `0003_identity.sql`). `fingerprint` is the hash of an address-book person's name and handles at the last import (migration `0005_contact_fingerprint.sql`). |
| `contact_handles` | Maps each handle to exactly one contact. `link_origin` is `auto`, `apple_contacts`, or `manual_merge`. |
| `merge_log` | Append-only audit of merges and unmerges (never message content). `handles_json` is `[{ handle_norm, prior_origin }]`; `anchor_handle` is a handle the target owned before the merge (it lets a rebuild find the target again); an undone merge carries `reverted_by`. See [CORE_IDENTITY.md](CORE_IDENTITY.md). |
| `pending_merges` | Manual merges waiting for handles that have not been imported yet (after a rebuild); applied automatically when all of a merge's handles exist (migration `0007_merge_anchor_pending.sql`). |
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

| Migration | Adds |
|---|---|
| `0001_init` | messages, handles, contacts, contact_handles, merge_log, contact_summary, sync_state, full-text index |
| `0002_sync_runs` | `sync_runs` |
| `0003_identity` | `external_id` and `merged_into` on contacts |
| `0004_message_meta` | `meta_json` on messages |
| `0005_contact_fingerprint` | contact `fingerprint` (skip unchanged address-book people) |
| `0006_handoffs` | `handoffs` audit |
| `0007_merge_anchor_pending` | `anchor_handle` on `merge_log`, `pending_merges` |
| `0008_profile` | `contact_details`, `contact_profile`, `contact_notes` |
| `0009_group_members` | `group_members` |
| `0010_clean_blob_names` | data fix: automatic contacts named after an encoded WhatsApp push name get their handle back |
| `0011_sends` | `sends` audit |
| `0012_read_state` | `read_state`, `app_settings` (unread baseline) |

## Startup failures

`openDb` throws `storage_unavailable`, `storage_corrupt` (failed `quick_check` or not a database) or `storage_migration_failed`. The service exits with code 74 and a one-line message. Recovery: restore a backup, or delete `core.db` and let connectors re-ingest (user data is lost in that case; see [CORE_OPERATIONS.md](CORE_OPERATIONS.md) (`restore`, `rebuild`; `rebuild` keeps manual merges, profile fields and notes)).

## Module interface

`openDb(home) -> { db, file }`; `createRepo(db) -> { setAfterBatch, upsertMessages, getThread, listContacts, search, getSyncState, setSyncState, rebuildSummary, ensureContactForHandle, handlesOf }`. The HTTP routes over these are specified in [CORE_API.md](CORE_API.md); cursors there are opaque encodings of the `(ts, id)` keyset used here. The unread counts are not stored in `contact_summary`: they are derived at read time from `read_state` and the baseline.

`NormalizedMessage`: `{ channel, account, providerMessageKey, threadKey, handle_norm, isFromMe, tsMs, subject?, text, attachments }`.

## Inspecting a database

```bash
REPLY_CORE_HOME=/path/to/home node core/scripts/db-inspect.js
```

Prints schema version, `quick_check` and row counts of the core tables (read-only).

## Known limitations

- Deletions at the source are not propagated.
- No encryption at rest beyond FileVault.

## Profile, group, read-state and send tables (migrations 0008, 0009, 0011, 0012)

| Table | Holds | Rebuilt from sources? |
|---|---|---|
| `contact_details` | address-book fields as JSON per contact (organization, job title, birthday, ...), replaced on every Contacts import | yes, by the next import |
| `contact_profile` | what the user wrote: profession, company, relationship, LinkedIn address, intro | **no** (user data, kept by backup and by `rebuild`) |
| `contact_notes` | the user's notes per contact | **no** (user data, kept by backup and by `rebuild`) |
| `group_members` (migration 0009) | members of group chats: group handle, member handle, WhatsApp's name for them, admin flag; replaced for a group each time the source is read | yes, by the next WhatsApp sync |
| `read_state` (migration 0012) | per contact, when you last had the conversation open at its newest message (user data). Kept by backup and restore; `rebuild` does not carry it, so after a rebuild everything counts as seen (the baseline restarts) | no |
| `app_settings` (migration 0012) | small key/value settings: the unread baseline and the dismissed duplicate suggestions (`dismissed_duplicates`) | no |
| `sends` (migration 0011) | one row per attempt to send from the app: id, client id (unique), time, contact id, channel, kind of address, text length, status (`sending`, `sent`, `failed`, `unknown`), error code, finish time. Never the text, the subject or the address | no (audit) |
