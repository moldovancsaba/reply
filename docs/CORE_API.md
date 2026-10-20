# Reply Core HTTP API

Status: living document, owned by issue #194; later issues add their endpoints here.

Loopback only (`127.0.0.1:45511` by default). Every error uses the envelope `{ "error": { "code", "message", "requestId", "retryable", "details"? } }` (see the README). Send `Host: 127.0.0.1:<port>` (or `localhost`); other hosts and foreign `Origin`s get `403`.

Response schemas for the read endpoints are in [`core/schema/api-read.json`](../core/schema/api-read.json) and are checked by the tests.

## Service

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | liveness: `{ status, version, uptimeSeconds, home, time }` |
| `GET /api/status`, `POST /api/status/recheck` | health of storage, helper and every source, with recovery steps; see [CORE_STATUS.md](CORE_STATUS.md) |
| `GET /api/drafts/capabilities`, `POST /api/drafts/suggest` | optional local-model reply suggestion; see [CORE_DRAFTING.md](CORE_DRAFTING.md) |
| `POST /api/handoff` | open Messages, Mail or WhatsApp with a prefilled reply (does not send); see [CORE_HANDOFF.md](CORE_HANDOFF.md) |
| `POST /api/send`, `POST /api/send/consent` | send a message through Messages, Mail or WhatsApp, and open {reply} to ask macOS for the permissions; see [CORE_SENDING.md](CORE_SENDING.md) |
| `POST /api/sync/:connector` | start a sync (`202`, `409`, `423`, `404`); see [CORE_CONNECTORS.md](CORE_CONNECTORS.md) |
| `POST /api/contacts/:id/merge`, `POST /api/contacts/:id/unmerge`, `GET /api/contacts/:id/merges` | explicit identity changes; see [CORE_IDENTITY.md](CORE_IDENTITY.md) |

## Read endpoints

All are `GET`, read-only and served from precomputed tables. Pagination is by opaque **cursor**: pass back `nextCursor` unchanged. A cursor that does not decode is `400 invalid_cursor`. Unknown query parameters are `400 invalid_request`. `limit` is 1 to 100 (list and search default 30, thread default 50).

### `GET /api/contacts`

Query: `q` (name or handle, max 200 characters), `channel` (`imessage`, `email`, `whatsapp`, or `all`), `limit`, `cursor`, `includeEmpty=true`.

One entry per person, newest activity first (`lastTs` descending, then id). People without any message are left out unless `includeEmpty=true` (they sort last, with `lastTs: null`). Contacts merged into another are never listed.

```json
{ "items": [ { "id": "c_1", "displayName": "Anna Kovacs", "lastTs": "2026-10-19T07:55:00.000Z", "lastChannel": "imessage",
               "lastPreview": "See you at 6", "lastFromMe": false,
               "counts": { "imessage": 412, "email": 31, "whatsapp": 0 }, "countTotal": 443,
               "handles": [ { "value": "+36301234567", "label": "+36 30 123 4567", "kind": "phone" } ] } ],
  "nextCursor": "eyJ0cyI6...", "hasMore": true, "total": 187 }
```

`total` counts everything matching the filters (not only this page). `value` is the stored handle, `label` is for display.

### `GET /api/contacts/:id`

`{ id, displayName, origin, counts, countTotal, handles[], replyChannels[] }` (`replyChannels` lists the channels a reply can be handed off to, see [CORE_HANDOFF.md](CORE_HANDOFF.md)). A contact that was merged into another is `404 contact_not_found` with `error.details.mergedInto`.

### `GET /api/contacts/:id/messages`

Query: `before` (cursor), `limit`, `channel`. One merged thread across all of the person's handles and channels, **newest first** (the UI reverses it for display):

```json
{ "items": [ { "id": "email:A:<id@mail>", "channel": "email", "isFromMe": false, "ts": "2026-10-19T07:00:00.000Z",
               "subject": "Invoice 42", "text": "Invoice 42\n\nsee attached", "isSummary": true,
               "attachments": [ { "name": "a.pdf", "mimeType": "application/pdf", "bytes": 10 } ],
               "counterpartHandle": "bela@example.com" } ],
  "nextCursor": "eyJ0cyI6...", "hasMore": false }
```

`isSummary: true` marks email text that is Mail's stored summary, not the full body. Group-chat messages carry `sender`. Pages never overlap or skip, even while new messages arrive: the cursor is the `(time, id)` position, so newer messages only appear when the first page is fetched again.

### `POST /api/send`

`{ "contactId", "channel", "handle"?, "text", "subject"? (email), "clientId" }` (any other key is `400`). `clientId` is 8 to 80 letters, digits, `-` or `_`, one per message. Success: `{ "sendId", "status": "sent", "channel", "handleLabel", "note" }`, or the same with `"replayed": true` for a repeated `clientId`. Errors and what they mean: [CORE_SENDING.md](CORE_SENDING.md#errors). `GET /api/contacts/:id` lists, per reply channel, `send: { available, reason? }`.

### Profile

`GET /api/contacts/:id/profile` is everything known about one person (`404 contact_not_found`, with `details.mergedInto` for a merged-away contact). It is computed from the stored data on each call:

```json
{ "id": "c_1", "displayName": "Anna Kovacs", "origin": "apple_contacts",
  "card": { "givenName": "Anna", "familyName": "Kovacs", "organization": "Acme", "jobTitle": "CFO", "birthday": "1985-03-09", "urls": ["https://acme.example"], "addresses": ["1 Main St, Budapest"] },
  "profile": { "profession": "", "company": "", "relationship": "Client", "linkedinUrl": "", "intro": "", "updatedAt": "2026-10-19T08:00:00.000Z" },
  "notes": [ { "id": "n_...", "text": "Prefers email", "createdAt": "..." } ],
  "handles": [ { "value": "+36301234567", "label": "+36 30 123 4567", "kind": "phone", "origin": "apple_contacts", "messages": 230, "lastTs": "..." } ],
  "stats": { "total": 237, "sent": 100, "received": 137, "firstTs": "...", "lastTs": "...", "lastSentTs": "...", "lastReceivedTs": "...", "last30Days": 12,
             "byChannel": { "imessage": { "total": 230, "sent": 99, "received": 131, "firstTs": "...", "lastTs": "..." }, "email": { }, "whatsapp": { } } },
  "mergedFrom": ["anna@example.com"],
  "members": [] }
```

`members` is filled only for a group chat: `[{ "handle", "name", "admin", "messages", "contactId" }]`, admins first, then by how much each member wrote in the group. `name` is your contact's name, else the name WhatsApp knows, else the number; `contactId` is set when that person also has a conversation of their own.

`card` is the address book as last imported (a birthday without a year is `--MM-DD`); it is replaced on every import and is read-only. `profile` and `notes` are what the user wrote.

- `PUT /api/contacts/:id/profile` with any of `profession` (200 characters), `company` (200), `relationship` (100), `linkedinUrl` (300, must be an `http(s)` address), `intro` (2,000). Missing fields keep their value, an empty string clears one, any other key is `400 invalid_request`. Returns the profile fields.
- `POST /api/contacts/:id/notes` with `{ "text": "..." }` (1 to 4,000 characters, at most 200 notes per contact, else `409 too_many_notes`) answers `201` with the note.
- `DELETE /api/contacts/:id/notes/:noteId` answers `{ "deleted": true }` or `404 note_not_found`.

Notes and profile fields are never logged. They follow the person: when an automatic contact is replaced by an address-book contact, or two contacts are merged and later split, nothing is lost (see [CORE_IDENTITY.md](CORE_IDENTITY.md)).

### `GET /api/search`

Query: `q` (required, at least 2 characters, max 200), `channel`, `contactId`, `limit`, `cursor`. Full-text search (FTS5, accent-insensitive, prefix match, every term must match). Terms are quoted before they reach SQLite, so operators and punctuation in the query are plain text.

```json
{ "items": [ { "messageId": "imessage::g1", "contactId": "c_1", "contactName": "Anna Kovacs", "channel": "imessage",
               "ts": "2026-10-19T07:55:00.000Z", "snippet": "…see the \u0001invoice\u0002 for…" } ],
  "nextCursor": "…", "hasMore": true }
```

The match is marked with the control characters `\u0001` (start) and `\u0002` (end), never HTML, so message content cannot inject markup; the UI maps them to `<mark>` elements with `parseSnippet` (see [CORE_UI.md](CORE_UI.md#search)). Snippets are at most 160 characters with the marks balanced.

Ranking: `S = bm25(text weight 1.0, subject weight 2.0)`, lower first, then newest, then id. A subject states the topic of a whole mail, so subject matches count double. The weights live in `core/src/read/service.js` (`TEXT_WEIGHT`, `SUBJECT_WEIGHT`). Search cursors encode `(rank, time, id)`; because bm25 depends on corpus statistics, a heavy ingest between pages can reorder results slightly.

## Errors

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_request` | bad or unknown parameter, `q` missing |
| 400 | `query_too_short` | `q` shorter than 2 characters |
| 400 | `invalid_cursor` | cursor not issued by this API |
| 404 | `contact_not_found` | unknown contact; merged-away contacts add `details.mergedInto` |

## Caching

First pages of the contact list and of a thread carry a weak `ETag` and `Cache-Control: private, max-age=0, must-revalidate`; send `If-None-Match` to get `304`. Everything else under `/api/` is `Cache-Control: no-store`.

## Performance

Measured on a 100,000-message corpus (2,000 contacts), including HTTP: list page about 2 ms, thread page under 1 ms, search about 3 ms. The tests assert the issue's budgets (list < 30 ms, thread < 20 ms, search < 80 ms) with 3x tolerance, and that the list and thread queries use `contact_summary_last` and `messages_handle_ts`.
