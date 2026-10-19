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
| `REPLY_CORE_CONNECTORS` | Comma list of connector ids to enable. Unset or empty: the defaults (`DEFAULT_ENABLED_IDS`, currently `imessage`, `contacts`, `apple-mail`). The single word `none` runs no connectors. Unknown ids are logged and ignored. |
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

## Apple Contacts (`contacts`, issue #192)

Imports people from the macOS address book through the native helper so conversations show real names and one person's channels share a contact. Interval 15 minutes.

| | |
|---|---|
| Permission | Contacts consent for the process that starts Reply Core. `doctor` reports `needs_consent` until the user has been asked; that is not a block, because the first export shows the macOS prompt. Denial blocks the connector with a recovery hint. |
| Export | Everyone in one call (the Contacts framework has no modification date). Unchanged people are skipped by fingerprint (a hash of the name and normalized handles) inside the identity import, so a re-run is cheap. |
| People | A person is identified by the Contacts identifier (`contacts.external_id`). People with no phone or email are not imported. A person with no name gets their first handle as the display name. |
| Handles | Every phone is linked as `+e164` **and** as its WhatsApp twin `+e164@wa`; every email as a lowercase address. Phones that cannot be normalized are counted in the log (`badHandles`), not imported. |
| Rules | The import follows [CORE_IDENTITY.md](CORE_IDENTITY.md): an auto contact yields to the address book and is deleted if it ends up empty; a manual merge is never overridden; a handle claimed by two address-book people stays with the first and the second is reported as a conflict (the `identity.import` log line shows `conflicts` and `protectedByMerge`). |
| Count | `messages_total` for this connector is the number of people imported. |

Limitations: a person removed from the address book stays in Reply Core (with their handles); old handles removed from a person stay linked until `identity-reset.js --to-auto`.

## Apple Mail (`apple-mail`, issue #193)

Reads the local Mail index through the native helper, so every account already set up in Mail (Gmail, iCloud, Exchange, IMAP) appears without storing any email credentials. Interval 2 minutes.

| | |
|---|---|
| Source | the newest `~/Library/Mail/V*/MailData/Envelope Index`, or `REPLY_CORE_MAIL_ROOT` |
| Cursor | `{ "rowid": n }`; page size 500 |
| Permission | Full Disk Access for the process that starts Reply Core |
| Included / excluded | inbox, sent, archive/All Mail and other folders are included; drafts, junk and trash are not; rows Mail marked deleted are not exported |
| Message key / account | the `Message-ID` (fallback `row:<rowid>`) / the Mail account id |
| Counterpart | received mail: the sender's address; sent mail: the first recipient. Mail sent only to undisclosed recipients has no counterpart and is quarantined. A mailing-list message has the list address as counterpart (merge or hide it as you like). |
| Direction | mail in a sent mailbox, or from an address that sends from a sent mailbox |
| Text | the subject, a blank line, and Mail's stored **summary** (the first lines of the body), not the full body. Mail without a subject keeps only the summary; HTML-only mail with no summary keeps only the subject. |
| `meta_json` | `{ isSummary: true, recipients: [...], accountLabel }`. `isSummary` lets the UI say that email text is a summary. The mailbox is not stored, so a copy of the same message arriving later from another mailbox (Gmail's All Mail) is a no-op. |
| Preflight | `source_missing` (no account in Mail) with the hint "Add an account in the Mail app", `permission_denied`, `schema_unsupported`, `helper_unavailable` |

Limitations: summaries only; no attachments; no HTML rendering; edits and deletions at the source are not propagated.

To discard imported email and re-ingest: stop the service, `node core/scripts/reset-cursor.js apple-mail --purge` (this removes **all** email rows, since the `email` channel is shared with the IMAP connector).

## Operations

- Stop syncing entirely: `REPLY_CORE_CONNECTORS=none` and restart. The service keeps serving existing data.
- Force a re-ingest of one connector: stop the service, `node core/scripts/reset-cursor.js <connector>` (add `--purge` to delete the messages it imported first; `apple-mail` and `imap` share the `email` channel, so purging either removes all email rows), start the service.
- Logs: `sync.run` (outcome, pages, counts, ms), `sync.retry` (code, attempt, delay) at warn, `sync.failed` (code, kind) at error. No message content.
- Process metrics (runs, failures by code, last duration) are available from `runner.metrics()` and are surfaced by the status API (#190).
