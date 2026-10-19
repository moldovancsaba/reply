# Reply Core HTTP API

Status: living document, owned by issue #194; later issues add their endpoints here.

Loopback only (`127.0.0.1:45511` by default). Every error uses the envelope `{ "error": { "code", "message", "requestId", "retryable", "details"? } }` (see the README). Send `Host: 127.0.0.1:<port>` (or `localhost`); other hosts and foreign `Origin`s get `403`.

Response schemas for the read endpoints are in [`core/schema/api-read.json`](../core/schema/api-read.json) and are checked by the tests.

## Service

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | liveness: `{ status, version, uptimeSeconds, home, time }` |
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

`{ id, displayName, origin, counts, countTotal, handles[] }`. A contact that was merged into another is `404 contact_not_found` with `error.details.mergedInto`.

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

### `GET /api/search`

Query: `q` (required, at least 2 characters, max 200), `channel`, `contactId`, `limit`, `cursor`. Full-text search (FTS5, accent-insensitive, prefix match, every term must match). Terms are quoted before they reach SQLite, so operators and punctuation in the query are plain text.

```json
{ "items": [ { "messageId": "imessage::g1", "contactId": "c_1", "contactName": "Anna Kovacs", "channel": "imessage",
               "ts": "2026-10-19T07:55:00.000Z", "snippet": "…see the \u0001invoice\u0002 for…" } ],
  "nextCursor": "…", "hasMore": true }
```

The match is marked with the control characters `\u0001` (start) and `\u0002` (end), never HTML, so message content cannot inject markup; the UI maps them to its highlight component. Snippets are at most 160 characters with the marks balanced.

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
