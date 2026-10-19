# Reply Core Status

Status: living document, owned by issue #190.

One report answers "is Reply Core working, and if not, what do I do?" for the database, the native helper and every source. It is the single source for the Sources screen (#202), so an empty inbox can never be mistaken for "no messages" while a source is blocked.

## Endpoints

`GET /api/status` returns the report. It is cheap and safe to poll: sync state is read from the database, the helper is probed at most every 30 s, and a built report is reused for 2 s. It carries a weak `ETag` (computed without the timestamp) so an unchanged state answers `304` to `If-None-Match`.

`POST /api/status/recheck` forgets the cached probes, re-checks every **blocked** source and, for each one that now works, clears the block and starts a sync. It returns the fresh report. This is what the "Recheck" button calls after the user grants a permission.

If the report itself cannot be built the answer is `500 status_unavailable` (retryable).

## Report

```json
{
  "overall": "blocked",
  "storage": { "state": "ok", "version": 5, "dbBytes": 18874368 },
  "helper": { "state": "ok", "version": "1.0.0 schema=1" },
  "connectors": [
    { "id": "imessage", "label": "iMessage", "state": "blocked", "code": "permission_denied",
      "message": "Reply Core cannot read your Messages.", "messagesTotal": 0,
      "recovery": [
        { "order": 1, "text": "Open System Settings > Privacy & Security > Full Disk Access.", "deepLink": "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles" },
        { "order": 2, "text": "Turn on the app that starts Reply Core, so it can read your Messages." },
        { "order": 3, "text": "Quit and reopen that app, then choose Recheck." } ] }
  ],
  "backups": { "count": 9, "totalBytes": 188743680, "lastBackupAt": "2026-10-19T03:00:11.000Z" },
  "metrics": { "runs": 12, "failuresByCode": { "permission_denied": 1 }, "lastDurationMs": 240 },
  "generatedAt": "2026-10-19T08:00:00.000Z"
}
```

Schema: [`core/schema/api-status.json`](../core/schema/api-status.json) (checked by the tests).

### Overall

- `blocked`: any source is `blocked`, the helper is not `ok`, or storage is in `error`.
- `degraded`: no block, but a source is in `error` (it will retry).
- `ok`: otherwise.

### Source states

| State | Meaning | Extra fields |
|---|---|---|
| `never_synced` | no successful run yet | |
| `syncing` | a run is in progress | `messagesThisRun` (inserted plus updated so far) |
| `ok` | last run succeeded | `lastSuccessAt`, `nextRunAt` |
| `blocked` | needs the operator; never retried automatically | `code`, `message`, `recovery[]` |
| `error` | failed, will retry at the next tick | `code`, `message`, `retryAt`, `lastErrorAt` |

`accounts[].account` is the account id (for IMAP an email address like `user@host`; the sync endpoint needs it). Logs never carry it: they use a short hash.

`messagesTotal` is messages imported (people imported, for Contacts). `lastSuccessAt` is clamped to the present, so a clock jump never shows a future time. A source with several accounts reports the worst state on top and lists every account in `accounts[]`.

### Backups

`backups.count` and `totalBytes` describe the snapshots in `backups/`; `lastBackupAt` is the newest; `lastBackupError` appears when the most recent attempt failed (it clears after the next success). See [CORE_OPERATIONS.md](CORE_OPERATIONS.md).

### Helper and storage

`helper.state`: `ok` (with `version`), `missing` (not built, not runnable, or an unsupported schema) or `checksum_mismatch` (the binary no longer matches the hash recorded by `helper/build.sh`). `storage.state`: `ok` (schema `version`, `dbBytes` including the write-ahead log) or `error` with `code` (`storage_corrupt`, `storage_unavailable`), `message` and `recovery[]`. The full `quick_check` runs once at start; the status check is a cheap probe, because a full check would block the service on a large database.

## Recovery catalog

All wording lives in [`core/src/status/recovery.js`](../core/src/status/recovery.js): a message and ordered steps for every connector error code, with overrides per source where the fix differs (Full Disk Access for Messages, Mail and WhatsApp; Contacts consent for Contacts; an app password for IMAP). `deepLink` values are fixed `x-apple.systempreferences:` strings, never built from input. A test fails if a code has no wording.

| Code | Default message |
|---|---|
| `permission_denied` | Reply Core is not allowed to read this source. |
| `source_missing` | This source was not found on this Mac. |
| `source_locked` | The source is busy. Reply Core will try again shortly. |
| `schema_unsupported` | The app changed how it stores data, so Reply Core stopped reading it to avoid wrong results. |
| `helper_unavailable` | The Reply Core helper is missing or was changed. |
| `timeout` | The source took too long to answer. Reply Core will try again. |
| `network_unavailable` | The connection failed. Reply Core will try again. |
| `auth_failed` | The account refused the sign-in. |
| `internal` | Something unexpected went wrong. Reply Core will try again. |

Only `blocked` states carry `recovery`; an `error` is automatic and says when it will retry.

## Privacy

The report contains counts, ids, codes and fixed catalog text only: no contact handles, names, subjects or message text (a test checks this). The one exception is the IMAP account id, which is the address you added yourself.

## How the UI shows it

| API | Sources screen |
|---|---|
| `connectors[].state` `ok` / `syncing` / `never_synced` / `error` / `blocked` | Connected / Syncing / Not synced yet / Problem, will retry / Needs your attention (text and icon, never colour alone) |
| `connectors[].message`, `recovery[]` | the sentence, then the ordered steps; a `deepLink` becomes a link only if it starts with `x-apple.systempreferences:` |
| `messagesThisRun` | "Imported N messages so far" while syncing |
| `lastSuccessAt`, `nextRunAt`, `retryAt` | "Last success", "Next check", "Next attempt" |
| `accounts[]` | one line per account under the connector |
| `storage.state = error`, `helper.state != ok` | an error alert above the panels, with `storage.recovery` |
| `POST /api/status/recheck` | the **Recheck** buttons; the report it returns replaces the cached status |

See [CORE_UI.md](CORE_UI.md#sources).
