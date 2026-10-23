# Technical design

The low-level design of Reply Core: how data moves, what is guaranteed, how it fails. [CORE_ARCHITECTURE.md](CORE_ARCHITECTURE.md) says what the parts are; the CORE_* documents are the reference for each part. This document explains the decisions that cut across them.

## 1. Data flow

```text
source apps (read-only)                 Reply Core service                             you
Messages chat.db ──┐
Mail Envelope Index ─┼─ helper (Swift, NDJSON) ─┐
Contacts framework ──┘                         │
WhatsApp ChatStorage.sqlite ─ direct read ──────┼─> connector.fetch(account, cursor)
IMAP (TLS, read-only) ─ imapflow ───────────────┘          │ page = { messages, contacts?, names?, groups?, nextCursor }
                                                            v
                         runner: ONE transaction = upsert messages + identity hooks + sync cursor
                                                            v
                                          SQLite core.db (WAL): messages, contacts, handles, summaries, ...
                                                            v
                                 read / profile services ─ HTTP on 127.0.0.1 ─> web app in your browser
                                                            ^                          │
                         send service ─ AppleScript ─> Messages / Mail / WhatsApp <────┘ (Send, after confirmation)
```

## 2. Guarantees

| Guarantee | Mechanism |
|---|---|
| A page of messages is never half applied, and the cursor never gets ahead of the data | the runner commits messages, identity updates (contacts, chat names, group members) and the cursor in one SQLite transaction; a failure rolls all back and the page is fetched again |
| Importing twice is harmless | messages are keyed `channel:account:providerMessageKey`; upserts are idempotent; contacts from the address book are skipped by fingerprint when unchanged |
| Other apps' data is never modified | helper and direct reads are read-only; IMAP uses `EXAMINE`; WhatsApp is read from a temporary copy when the live file cannot be opened |
| People are never merged by guesswork | the only merges are explicit user requests; a merge is logged with an anchor handle and can be undone exactly; chains must be undone in reverse |
| What you wrote survives | profile fields, notes, merges and manual names are exported by handle (not row id) and replayed by `rebuild`; a note about a person whose messages are not back yet gets an automatic contact for that handle |
| A message is sent at most once per request | `clientId` idempotency in `sends`; an unknown outcome is never retried blindly |
| Nothing personal reaches a log | a redaction list, counts-only log lines, tests that capture logs and fail on a leak |

## 3. Identity

A **handle** is a normalised counterpart identifier (`+36301234567`, `anna@example.com`, `+36301234567@wa` for WhatsApp, `group:<jid>`, `other:<id>`). A **contact** owns handles through `contact_handles` with a `link_origin` (`auto`, `apple_contacts`, `manual_merge`). The first message from an unseen handle creates an `auto` contact named after the handle. The address-book import creates `apple_contacts` contacts and takes over handles from `auto` contacts (the emptied auto contact is deleted; its notes and profile fields move to the heir). A WhatsApp chat or group name may rename an `auto` contact, never an address-book or merged one. Precedence: manual merge > address book > auto. A merge hides the source (`hidden = 1`, `merged_into`) so it can be restored. Details: [CORE_IDENTITY.md](CORE_IDENTITY.md).

## 4. Reading

- **List:** ordered by the summary table's own columns so SQLite walks the `contact_summary_last` index; keyset (cursor) pagination on `(last_ts, id)`, never offsets; first pages carry an ETag.
- **Thread:** all handles of the contact in one query on `messages_handle_ts`, newest first by `(ts, id)`; pages never overlap or skip even while messages arrive.
- **Search:** FTS5 with `remove_diacritics`, prefix match, every term must match; terms are quoted before they reach SQLite; ranking `bm25(text 1.0, subject 2.0)` then newest then id; snippets mark matches with control characters, never HTML.
- **Unread:** derived at read time: received messages newer than the contact's `read_state.read_ms` (or the baseline recorded when the feature first ran).
- **Profile:** computed per call from `messages` (counts, first/last, per channel, last sent/received, last 30 days) plus stored details, profile fields, notes and group members.
- Measured at 500,000 messages: every read under 15 ms ([CORE_OPERATIONS.md](CORE_OPERATIONS.md#scale-check)).

## 5. Sending

```text
UI: Send -> confirmation (recipient, channel, exact text) -> POST /api/send { contactId, channel, text, subject?, clientId }
service: validate -> idempotency lookup by clientId -> recipient = one of the contact's own handles -> rate limit (1 at a time, 10/min)
         -> insert sends(status = sending) -> driver (osascript, text as argv) -> sent | failed | unknown (timeout 45 s)
         -> schedule two re-reads of the source (3 s, 12 s) so the sent message arrives through the normal import
```

Files (iMessage and Mail): the page uploads each file first (`POST /api/uploads`, raw bytes) and names them by id in `attachmentIds`; they wait in `<home>/outbox` (owner only, one hour, emptied at start) and the service never reads a path from a request. WhatsApp sends are confirmed afterwards by looking for the message in WhatsApp's own database (read-only, up to 15 s, the person's phone numbers and `@lid` ids), with one repeated Return after 5 s; Mail and WhatsApp give the focus back to the app you were in.

States of a `sends` row: `sending` (in flight), `sent`, `failed` (nothing was sent), `unknown` (no answer in time; may have been sent). A repeated `clientId` returns the stored outcome. Drivers: iMessage (iMessage service, then SMS), Mail (a new outgoing message, sent), WhatsApp (`whatsapp://send` then Return once WhatsApp is frontmost). Reference: [CORE_SENDING.md](CORE_SENDING.md).

## 6. Concurrency and process model

One Node process; `better-sqlite3` is synchronous, so every database call is a short critical section, WAL lets readers and the single writer coexist, and a backup uses SQLite's online backup API. Connector runs are async (one per connector and account at a time, with backoff for retryable errors); the scheduler never overlaps runs of the same source. The helper is a child process with a 30 s timeout, killed as a process group. Sends are serialised. Shutdown stops the scheduler, removes the pidfile, closes idle keep-alive connections and exits within 5 s.

## 7. Failure behaviour

| Failure | Behaviour |
|---|---|
| a permission is missing or revoked | the connector is `blocked` with a recovery catalog entry; the Sources screen shows the steps; `Recheck` clears it |
| a source is busy or the network fails | retryable: exponential backoff with jitter, `sync.retry` logged; non-retryable codes block |
| WhatsApp changes its layout | `schema_unsupported`: reading stops, nothing is written |
| the database is corrupt or a migration fails | exit 74 with one line; restore a backup or rebuild |
| the port is taken | exit 75 (the launcher explains) |
| a migration changed after it was applied | exit with `migration_checksum_mismatch`; fix forward with a new file |
| not enough free disk for migration 0014 | exit 74 before anything is touched, with one line naming the space needed and `reply-core restore` |
| a migration's own verification fails (0014: counts, FTS, foreign keys) | the migration's transaction rolls back; the database stays at the previous version; exit 74 with the failing check |
| AppleScript is refused (Automation / Accessibility) | `automation_denied` / `accessibility_denied` with steps and an Allow button; nothing is sent |
| a WhatsApp message does not show up in its database | `send_unconfirmed`, recorded `unknown`: it may have been sent, no blind retry; in another chat: `whatsapp_wrong_chat`; database unreadable: sent but `confirmed: false` |
| a script with files fails part way | `send_failed_partial`, recorded `unknown` |
| mail to yourself (a sent copy and a received copy in two Mail accounts) | collapsed into one message at import (same provider key, time, subject), older twins removed once at start |

## 8. Interfaces and contracts

- **HTTP:** loopback only, `Host`/`Origin` guards, strict CSP, uniform error envelope `{ error: { code, message, requestId, retryable, details? } }`, `no-store` except ETag'd first pages; response schemas in `core/schema/*.json` generate the UI's types and are checked in tests.
- **Helper protocol:** NDJSON, `schemaVersion` 1, validated against `core/helper/schema/v1.json`; additive fields only.
- **Connector interface:** `{ id, channel, intervalMs, accounts(), preflight(), fetch(account, cursor, { limit, signal }) }` ([CORE_CONNECTORS.md](CORE_CONNECTORS.md)).
- **Configuration:** environment variables `REPLY_CORE_*`, validated once at start; unknown ones are reported and ignored ([core/README.md](../core/README.md)).

## 9. Build, test and release

`npm run verify` (lint with zero warnings, Swift tests, Node tests on synthetic source copies, UI lint/types/unit tests/build/bundle budget 250 KB gzip, Playwright with the GDS accessibility gate in light/dark/375 px against the real service) and `npm run verify:release` (adds the launcher smoke test, the repository and documentation audit and the dependency audit). Tests never touch real data and never send: the service under test uses the `fake` send driver. Releases: [CHANGELOG.md](../CHANGELOG.md).
