# Reply Core

A local-first unified inbox for macOS: one process, one SQLite file and one web app over iMessage, Apple Mail, Contacts and, optionally, WhatsApp and IMAP, with a merged conversation per person, a contact profile, search, sending through the apps you already use, and an optional local-model reply suggestion. Everything stays on your Mac: the API listens on `127.0.0.1` only.

Start with [`../docs/CORE_FIRST_RUN.md`](../docs/CORE_FIRST_RUN.md) (set-up) or [`../docs/USER_GUIDE.md`](../docs/USER_GUIDE.md) (daily use). The map of all documents is [`../docs/README.md`](../docs/README.md); the runtime flow is [`../docs/CORE_ARCHITECTURE.md`](../docs/CORE_ARCHITECTURE.md). The previous generation of the project is archived in [`../legacy/`](../legacy/README.md) and shares nothing with this directory.

## Run

```bash
cd core
npm install
node scripts/reply-core start       # checks Node, builds the UI and the {reply} app if needed, starts the service, opens Safari
node scripts/reply-core status
node scripts/reply-core stop
```

`npm start` runs only the service in the foreground (logs to stdout). The launcher also offers `open`, `logs`, `build-app` (the signed `{reply}.app` that starts the service, so macOS permissions belong to a named app), `install-agent` and `uninstall-agent` (start at login); see [`../docs/CORE_OPERATIONS.md`](../docs/CORE_OPERATIONS.md). Requires Node >= 20.17.

## First run

1. Start the service. With no working source the app opens on **Sources**.
2. For each source marked **Needs your attention**, follow the numbered steps (most are macOS permissions: Full Disk Access for {reply} or whatever started Reply Core, and Contacts). The links open the right System Settings pane.
3. Press **Recheck**. When a source works it turns **Connected**, starts importing and the page tells you ("iMessage is connected.").
4. Open **Inbox**. People appear as soon as their messages are imported; the first import of a large history can take a while ("Imported N messages so far").

Details: [`../docs/CORE_PERMISSIONS.md`](../docs/CORE_PERMISSIONS.md).

## Configuration

Every setting is optional. See [`.env.example`](.env.example). Values are read from the process environment once at start; invalid values stop the service immediately.

| Variable | Default | Meaning |
|---|---|---|
| `REPLY_CORE_HOME` | `~/Library/Application Support/reply-core` | Data home (created with mode 0700) |
| `REPLY_CORE_PORT` | `45511` | Loopback port, 1024-65535 |
| `REPLY_CORE_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `REPLY_CORE_LOG_FILE`, `REPLY_CORE_LOG_MAX_BYTES` | none (stdout), `10485760` | write logs to a file rotated at that size, keeping 5 files (the launcher sets it to `~/Library/Logs/reply-core/service.log`) |
| `REPLY_CORE_CONNECTORS` | `imessage,contacts,apple-mail` (plus `imap` once an account has been added) | Connectors to run (comma list, or `none`); see [`../docs/CORE_CONNECTORS.md`](../docs/CORE_CONNECTORS.md) |
| `REPLY_CORE_IMESSAGE_DB` | `~/Library/Messages/chat.db` | Path to the Messages database |
| `REPLY_CORE_MAIL_ROOT` | `~/Library/Mail` | Folder holding Mail's `V*` data |
| `REPLY_CORE_LLM` | `off` | `ollama` turns on optional reply suggestions ([`../docs/CORE_DRAFTING.md`](../docs/CORE_DRAFTING.md)) |
| `REPLY_CORE_OLLAMA_MODEL`, `REPLY_CORE_OLLAMA_URL` | none, `http://127.0.0.1:11434` | model and address of the local Ollama |
| `REPLY_CORE_WHATSAPP_DB` | auto-detected | Path to WhatsApp Desktop's `ChatStorage.sqlite` (the connector is opt-in: add `whatsapp` to `REPLY_CORE_CONNECTORS`) |
| `REPLY_CORE_BROWSER` | `Safari` | app the launcher opens the UI in; `default` uses the system default browser |
| `REPLY_CORE_UI_DIR` | `ui/dist` | Folder with the built web app |
| `REPLY_CORE_HELPER` | `helper/bin/reply-core-helper` | Path to the native helper binary |
| `REPLY_CORE_<ID>_INTERVAL_MS` | connector default | Sync interval for one connector, >= 1000 |
| `REPLY_CORE_DEFAULT_REGION` | `HU` | Country used to read phone numbers written without a country code |
| `REPLY_CORE_ALLOWED_ORIGINS` | empty | Extra browser origins allowed to call the API (for example a UI dev server). The service's own origin is always allowed. |
| `REPLY_CORE_SENDING` | `on` | `off` removes sending from the app (the Send button, `POST /api/send`); see [`../docs/CORE_SENDING.md`](../docs/CORE_SENDING.md) |
| `REPLY_CORE_SEND_DRIVER` | `applescript` | `fake` records instead of sending: for tests only |
| `REPLY_CORE_APP` | set by the launcher | path of `{reply}.app`, used to ask macOS for sending permissions |
| `REPLY_CORE_ALLOW_REMOTE_LLM` | unset | `1` allows a non-loopback Ollama URL (conversation text then leaves this Mac) |
| `REPLY_CORE_BROWSER` | `Safari` | app the launcher opens the UI in; `default` uses the system browser |

Launcher-only variables (tests and special setups): `REPLY_CORE_OPEN`, `REPLY_CORE_NO_APP`, `REPLY_CORE_LAUNCHCTL`, `REPLY_CORE_NODE`, `REPLY_CORE_SIGN_IDENTITY`.

Unknown `REPLY_CORE_*` variables are ignored and reported once at info level.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Clean shutdown |
| 1 | Another start failure, or a shutdown that had to be forced |
| 2 | (backup, restore, rebuild commands) usage error |
| 3 | (same commands) Reply Core is running or another operation is |
| 4 | (same commands) a backup failed verification |
| 5 | (same commands) an I/O error |
| 74 | Storage could not be opened, is corrupt, or a migration failed |
| 75 | Port already in use (is Reply Core already running?) |
| 78 | Invalid configuration (the message names the setting) |

The launcher has its own codes (10 to 13, plus the service's 74, 75, 78); see [`../docs/CORE_OPERATIONS.md`](../docs/CORE_OPERATIONS.md).

## Data

`core.db` lives in `REPLY_CORE_HOME` (mode 0600; the directory is 0700). Layout and invariants: [`../docs/CORE_DATA_MODEL.md`](../docs/CORE_DATA_MODEL.md). Inspect it with `node scripts/db-inspect.js`.

## API

The full list is [`../docs/CORE_API.md`](../docs/CORE_API.md). By area: the inbox (list, conversation, search, new-message counts), the contact profile and notes, merge and undo ([`CORE_IDENTITY.md`](../docs/CORE_IDENTITY.md)), sending and handoff ([`CORE_SENDING.md`](../docs/CORE_SENDING.md), [`CORE_HANDOFF.md`](../docs/CORE_HANDOFF.md)), reply suggestions ([`CORE_DRAFTING.md`](../docs/CORE_DRAFTING.md)), status and sync ([`CORE_STATUS.md`](../docs/CORE_STATUS.md), [`CORE_CONNECTORS.md`](../docs/CORE_CONNECTORS.md)).

## Syncing

Enabled connectors run on their own intervals. Trigger one now with `curl -X POST http://127.0.0.1:45511/api/sync/<id>` (202 accepted). Try the framework without any source app with `REPLY_CORE_CONNECTORS=stub npm start`.

## Sending

Press **Send** in the Reply box and the message is sent through Messages, Mail or WhatsApp Desktop (AppleScript), once, after a confirmation. Files can go with iMessage and Mail (picked files wait in `<home>/outbox`); a WhatsApp send is checked against WhatsApp's own data; Mail and WhatsApp hand the focus back to your app. It needs Automation permission for {reply} (and Accessibility for WhatsApp); the Sources screen has the buttons that ask for it. Rules, errors and permissions: [`../docs/CORE_SENDING.md`](../docs/CORE_SENDING.md). `REPLY_CORE_SENDING=off` turns it off.

## IMAP accounts

`node bin/reply-core.js accounts add-imap|list|remove` manages mailboxes that are not in Apple Mail; passwords live in the keychain, never in files ([`../docs/CORE_SECURITY.md`](../docs/CORE_SECURITY.md), [`../docs/CORE_CONNECTORS.md`](../docs/CORE_CONNECTORS.md)).

## UI

The web app is in `ui/` (React + TypeScript, GDS only; installing it needs a GitHub token, see [`ui/README.md`](ui/README.md)). Build it with `npm --prefix ui run build`; the service then serves it at `http://127.0.0.1:45511/`. Screens, states and the design-system rules: [`../docs/CORE_UI.md`](../docs/CORE_UI.md), [`../docs/DESIGN_SYSTEM.md`](../docs/DESIGN_SYSTEM.md).

## Backups

`node bin/reply-core.js backup | backups list | restore <file> | rebuild`: one automatic backup per day, verified restores, and a rebuild that keeps your manual merges, profile fields and notes ([`../docs/CORE_OPERATIONS.md`](../docs/CORE_OPERATIONS.md)).

## Native helper

`helper/` is a Swift CLI that exports iMessage, Mail and Contacts as NDJSON and stores IMAP app passwords in the keychain. Build it once with `bash helper/build.sh` (`npm run verify` does this on macOS). See [`helper/README.md`](helper/README.md) and [`../docs/CORE_PERMISSIONS.md`](../docs/CORE_PERMISSIONS.md).

## Test fixtures

`npm run fixtures -- --seed 42 --out /tmp/rc-fixtures` builds synthetic Messages, Mail, WhatsApp and Contacts sources (see [`test/fixtures/README.md`](test/fixtures/README.md)). Connector tests use these instead of personal data.

## Verify

```bash
npm run verify           # lint (no warnings), helper build and tests (macOS), server tests, UI checks in Chrome and WebKit (when ui/node_modules exists; once: npx playwright install webkit in ui)
npm run verify:release   # the release gate: all of it, the launcher smoke test, the repository audit and the dependency audit, as one table
node scripts/audit.js    # the repository and documentation audit on its own
```

`npm run lint` and `npm test` run the first two parts separately. `node scripts/bench.js` is the scale check.

## Security notes

- Binds `127.0.0.1` only.
- Requests with a `Host` other than `127.0.0.1:<port>` or `localhost:<port>` get `403 forbidden_host` (DNS-rebinding guard). A foreign `Origin` gets `403 forbidden_origin`.
- Request bodies are limited to 1 MiB (JSON); an uploaded file for a message is limited to 20 MB and only accepted as raw `application/octet-stream` on `POST /api/uploads`.
- Logs are structured JSON (pino) and redact `text`, `body`, `handle`, `email`, `phone`, `displayName` (up to two levels deep), and authorization/cookie headers. Log ids, counts and error classes instead of content.

## Error envelope

Every error response has this shape:

```json
{ "error": { "code": "invalid_request", "message": "...", "requestId": "req_...", "retryable": false } }
```

Status 500 never includes a stack trace; the stack is in the service log under the same `requestId`.
