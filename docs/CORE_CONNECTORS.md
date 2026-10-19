# Reply Core Connectors

Status: living document, owned by issue #188. Each connector issue adds its own section.

A connector only **fetches and normalizes**. The framework (`core/src/connectors`) owns everything operational: scheduling, locking, preflight, paging, atomic cursor commits, retries, run records.

## Interface

```js
{
  id: "imessage",                       // lowercase, [a-z0-9-]
  channel: "imessage" | "email" | "whatsapp" | "contacts",
  intervalMs: 60_000,                   // default interval; REPLY_CORE_<ID>_INTERVAL_MS overrides (>= 1000)
  accounts(): Promise<string[]>,        // [""] for single-account sources
  preflight(): Promise<{ ok: true } | { ok: false, code, hint }>,
  fetch(account, cursor, { limit, signal }): Promise<{ messages, contacts?, nextCursor, more }>,
}
```

`messages` are `NormalizedMessage` (see [CORE_DATA_MODEL.md](CORE_DATA_MODEL.md)); handle normalization is the identity module's job (#189). `fetch` receives the stored cursor (`{}` the first time) and must be safe to call again with the same cursor (the page is refetched after any failure). Add a connector by writing the module, registering it in `core/src/connectors/registry.js` (`AVAILABLE`) and, when it should run by default, in `DEFAULT_ENABLED_IDS` (`core/src/config.js`).

## Runtime flow

```text
scheduler tick (interval) | POST /api/sync/:connector
  -> runner.start(connector, account)           lock per (connector, account); sync_state = running; sync_runs row
       preflight()                              not ok -> blocked
       loop:
         fetch(account, cursor, {limit 500, signal})       30 s timeout
         one transaction: upsertMessages(page) + contacts hook + cursor/total update
         more? yield to the event loop, repeat
       sync_state = idle, last_success_ms
     failure -> classify: retryable -> backoff, up to 5 attempts | blocked -> state blocked | else -> state error
```

The cursor only advances in the same transaction as the batch. A failure after fetch rolls both back and the next run refetches the same page; idempotent upserts make this effectively exactly-once.

## Error codes

| Code | Class | Behaviour |
|---|---|---|
| `source_locked`, `network_unavailable`, `timeout` | retryable | backoff `min(60 s, 1 s * 2^(n-1))` with jitter (x0.5 to x1.0), max 5 attempts per run, then state `error` |
| `permission_denied`, `source_missing`, `schema_unsupported`, `helper_unavailable`, `auth_failed` | blocked | state `blocked`; never retried by the scheduler; cleared by a manual run whose preflight succeeds |
| anything else (`internal`) | fatal | the run fails (state `error`), retried at the next scheduled tick |

`HelperError` from `core/src/helper` uses the same codes, so connectors can let it propagate.

A connector that returns `more: true` with an unchanged cursor is a bug: the run fails with `internal` instead of looping.

## State

`sync_state` (per connector and account): `idle`, `running`, `error`, `blocked`, cursor, last success/error, `messages_total` (messages inserted so far). `sync_runs` keeps the last 50 runs per connector (outcome, attempts, pages, inserted/updated/skipped/quarantined, error code). On start, any `running` state left by a crash is reset to `idle`. Shutdown aborts in-flight fetches (their runs end `aborted`, state back to `idle`, not an error).

## API

`POST /api/sync/:connector` with an empty body or `{ "account": "" }`:

| Status | Body | When |
|---|---|---|
| 202 | `{ "accepted": true, "runId": "r_...", "state": "running" }` | run started |
| 404 | `unknown_connector` | not enabled |
| 409 | `already_running` | a run is active for that source |
| 423 | `blocked` with the connector's hint | blocked and preflight still fails |
| 400 | `invalid_request` | bad body |

A blocked connector is re-checked first; if its preflight now succeeds it is cleared and the run starts.

## Configuration

| Variable | Meaning |
|---|---|
| `REPLY_CORE_CONNECTORS` | Comma list of connector ids to enable. Unset or empty: the defaults (`DEFAULT_ENABLED_IDS`, currently `imessage`). The single word `none` runs no connectors. Unknown ids are logged and ignored. |
| `REPLY_CORE_<ID>_INTERVAL_MS` | Interval for one connector (`APPLE_MAIL` for `apple-mail`), integer >= 1000. |

`REPLY_CORE_CONNECTORS=stub` enables a deterministic demo connector (three pages of synthetic messages) for trying the framework without any source app.

## iMessage (`imessage`, issue #191)

Reads Apple Messages through the native helper (`helper imessage`), incrementally by message `ROWID`, every 60 s.

| | |
|---|---|
| Source | `~/Library/Messages/chat.db`, or `REPLY_CORE_IMESSAGE_DB` |
| Cursor | `{ "rowid": n }`; page size 500 |
| Permission | Full Disk Access for the process that starts Reply Core ([CORE_PERMISSIONS.md](CORE_PERMISSIONS.md)) |
| Message key | the message `guid`; `account` is empty |
| Handle | the other party, normalized ([CORE_IDENTITY.md](CORE_IDENTITY.md)); handles stored without `+` or as email ids are normalized the same way |
| Groups | one thread handle `group:<chat guid>` per group chat; the sender of each received message is in `meta_json.sender`; messages you sent have no sender |
| Text | plain text, else the decoded `attributedBody`, else `[Attachment: name]` / `[Attachments: n]`; attachments keep name, type and size only |
| Skipped | reactions and tapbacks (counted in the log as `skippedReactions`), rows whose handle cannot be normalized (`skippedBadHandle`) |
| Dates | Apple-epoch seconds or nanoseconds are converted; a row with no usable date is quarantined by storage |
| Preflight | `helper doctor`: `permission_denied`, `source_missing`, `schema_unsupported` become blocked states with a recovery hint; a missing or modified helper is `helper_unavailable` |

Limitations: edits and unsends are not propagated; reactions are not shown; a message whose text cannot be decoded is stored with empty text (the log shows `undecodable`).

Run it: `REPLY_CORE_CONNECTORS=imessage npm start`, then `curl -X POST http://127.0.0.1:45511/api/sync/imessage`. To discard imported iMessage rows and re-ingest: stop the service, `node core/scripts/reset-cursor.js imessage --purge`.

## Operations

- Stop syncing entirely: `REPLY_CORE_CONNECTORS=none` and restart. The service keeps serving existing data.
- Force a re-ingest of one connector: stop the service, `node core/scripts/reset-cursor.js <connector>` (add `--purge` to delete the messages it imported first; `apple-mail` and `imap` share the `email` channel, so purging either removes all email rows), start the service.
- Logs: `sync.run` (outcome, pages, counts, ms), `sync.retry` (code, attempt, delay) at warn, `sync.failed` (code, kind) at error. No message content.
- Process metrics (runs, failures by code, last duration) are available from `runner.metrics()` and are surfaced by the status API (#190).
