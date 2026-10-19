# Reply Core

Lean, local-first unified inbox service. One Node process, loopback-only HTTP API. See [`../REPLY_CORE_PLAN.md`](../REPLY_CORE_PLAN.md) for the program and [`../docs/CORE_ARCHITECTURE.md`](../docs/CORE_ARCHITECTURE.md) for the runtime flow.

This directory is independent of `chat/` (the legacy hub); it shares nothing with it.

## Run

```bash
cd core
npm install
node scripts/reply-core start       # checks Node, builds the UI if needed, starts the service, opens the browser
node scripts/reply-core status
node scripts/reply-core stop
```

`npm start` runs only the service in the foreground (logs to stdout). The launcher also offers `logs`, `open`, and an optional start-at-login agent (`install-agent`); see [`../docs/CORE_OPERATIONS.md`](../docs/CORE_OPERATIONS.md). `npm run verify:release` is the release gate.

Requires Node >= 20.17.

## First run

1. Start the service and open <http://127.0.0.1:45511>. With no working source the app opens on **Sources**.
2. For each source marked **Needs your attention**, follow the numbered steps (most are macOS permissions: Full Disk Access for the process that started Reply Core, and Contacts). The links open the right System Settings pane.
3. Press **Recheck**. When a source works it turns **Connected**, starts importing and the page tells you ("iMessage is connected.").
4. Open **Inbox**. People appear as soon as their messages are imported; the first import of a large history can take a while ("Imported N messages so far").

Details: [`../docs/CORE_PERMISSIONS.md`](../docs/CORE_PERMISSIONS.md) and [`../docs/CORE_UI.md`](../docs/CORE_UI.md#sources).

## Configuration

Every setting is optional. See [`.env.example`](.env.example). Values are read from the process environment once at start; invalid values stop the service immediately.

| Variable | Default | Meaning |
|---|---|---|
| `REPLY_CORE_HOME` | `~/Library/Application Support/reply-core` | Data home (created with mode 0700) |
| `REPLY_CORE_PORT` | `45511` | Loopback port, 1024-65535 |
| `REPLY_CORE_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `REPLY_CORE_LOG_FILE`, `REPLY_CORE_LOG_MAX_BYTES` | none (stdout), `10485760` | write logs to a file rotated at that size, keeping 5 files (the launcher sets it to `~/Library/Logs/reply-core/service.log`) |
| `REPLY_CORE_CONNECTORS` | `imessage,contacts,apple-mail` | Connectors to run (comma list, or `none`); see [`../docs/CORE_CONNECTORS.md`](../docs/CORE_CONNECTORS.md) |
| `REPLY_CORE_IMESSAGE_DB` | `~/Library/Messages/chat.db` | Path to the Messages database |
| `REPLY_CORE_MAIL_ROOT` | `~/Library/Mail` | Folder holding Mail's `V*` data |
| `REPLY_CORE_LLM` | `off` | `ollama` turns on optional reply suggestions ([`../docs/CORE_DRAFTING.md`](../docs/CORE_DRAFTING.md)) |
| `REPLY_CORE_OLLAMA_MODEL`, `REPLY_CORE_OLLAMA_URL` | none, `http://127.0.0.1:11434` | model and address of the local Ollama |
| `REPLY_CORE_WHATSAPP_DB` | auto-detected | Path to WhatsApp Desktop's `ChatStorage.sqlite` (the connector is opt-in: add `whatsapp` to `REPLY_CORE_CONNECTORS`) |
| `REPLY_CORE_UI_DIR` | `ui/dist` | Folder with the built web app |
| `REPLY_CORE_HELPER` | `helper/bin/reply-core-helper` | Path to the native helper binary |
| `REPLY_CORE_<ID>_INTERVAL_MS` | connector default | Sync interval for one connector, >= 1000 |
| `REPLY_CORE_DEFAULT_REGION` | `HU` | Country used to read phone numbers written without a country code |
| `REPLY_CORE_ALLOWED_ORIGINS` | empty | Extra browser origins allowed to call the API (for example a UI dev server). The service's own origin is always allowed. |

Unknown `REPLY_CORE_*` variables are ignored and reported once at info level.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Clean shutdown |
| 3 | (backup/restore/rebuild commands) Reply Core is running or another operation is |
| 75 | Port already in use (is Reply Core already running?) |
| 74 | Storage could not be opened, is corrupt, or a migration failed |
| 78 | Invalid configuration (the message names the setting) |

## Data

`core.db` lives in `REPLY_CORE_HOME` (mode 0600; the directory is 0700). Layout and invariants: [`../docs/CORE_DATA_MODEL.md`](../docs/CORE_DATA_MODEL.md). Inspect it with `node scripts/db-inspect.js`.

## API

`GET /api/status` reports whether storage, the helper and each source are working and how to fix what is not ([`../docs/CORE_STATUS.md`](../docs/CORE_STATUS.md)). `GET /api/contacts`, `/api/contacts/:id`, `/api/contacts/:id/messages` and `/api/search` read the unified inbox; see [`../docs/CORE_API.md`](../docs/CORE_API.md).

## Syncing

Enabled connectors run on their own intervals. Trigger one now with `curl -X POST http://127.0.0.1:45511/api/sync/<id>` (202 accepted). Try the framework without any source app with `REPLY_CORE_CONNECTORS=stub npm start`. iMessage needs Full Disk Access for the process that starts the service (see [`../docs/CORE_PERMISSIONS.md`](../docs/CORE_PERMISSIONS.md)). Re-ingest from scratch with `node scripts/reset-cursor.js <id> [--purge]` (service stopped).

## IMAP accounts

`node bin/reply-core.js accounts add-imap|list|remove` manages mailboxes that are not in Apple Mail; passwords live in the keychain, never in files ([`../docs/CORE_SECURITY.md`](../docs/CORE_SECURITY.md), [`../docs/CORE_CONNECTORS.md`](../docs/CORE_CONNECTORS.md)).

## UI

The web app is in `ui/` (React + TypeScript, GDS only; installing it needs a GitHub token, see [`ui/README.md`](ui/README.md)). Build it with `npm --prefix ui run build`; the service then serves it at `http://127.0.0.1:45511/`. Shell contract, states, theme and the accessibility gate: [`../docs/CORE_UI.md`](../docs/CORE_UI.md).

## Backups

`node bin/reply-core.js backup | backups list | restore <file> | rebuild`: one automatic backup per day, verified restores, and a rebuild that keeps your manual merges ([`../docs/CORE_OPERATIONS.md`](../docs/CORE_OPERATIONS.md)).

## Native helper

`helper/` is a Swift CLI that exports iMessage, Mail and Contacts as NDJSON. Build it once with `bash helper/build.sh` (`npm run verify` does this on macOS). See [`helper/README.md`](helper/README.md) and [`../docs/CORE_PERMISSIONS.md`](../docs/CORE_PERMISSIONS.md).

## Test fixtures

`npm run fixtures -- --seed 42 --out /tmp/rc-fixtures` builds synthetic Messages, Mail, WhatsApp and Contacts sources (see [`test/fixtures/README.md`](test/fixtures/README.md)). Connector tests use these instead of personal data.

## Verify

```bash
npm run verify    # lint (no warnings) + tests; fails on any Node warning in the output
```

`npm run lint` and `npm test` run the two steps separately.

## Security notes

- Binds `127.0.0.1` only.
- Requests with a `Host` other than `127.0.0.1:<port>` or `localhost:<port>` get `403 forbidden_host` (DNS-rebinding guard). A foreign `Origin` gets `403 forbidden_origin`.
- Request bodies are limited to 1 MiB.
- Logs are structured JSON (pino) and redact `text`, `body`, `handle`, `email`, `phone`, `displayName` (up to two levels deep), and authorization/cookie headers. Log ids, counts and error classes instead of content.

## Error envelope

Every error response has this shape:

```json
{ "error": { "code": "invalid_request", "message": "...", "requestId": "req_...", "retryable": false } }
```

Status 500 never includes a stack trace; the stack is in the service log under the same `requestId`.

## Troubleshooting

- `reply-core: port 45511 is already in use`: another instance is running, or set `REPLY_CORE_PORT`.
- `403 forbidden_host`: you called the service by a hostname other than `127.0.0.1` or `localhost`.
- `reply-core: invalid configuration: ...`: fix the named variable.
