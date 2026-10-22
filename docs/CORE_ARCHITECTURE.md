# Reply Core Architecture

Status: living document. Update it whenever a service, route, convention or file in the ownership table changes. The map of all documents is [README.md](README.md); the low-level design (data flow, contracts, concurrency) is [TECH_DESIGN.md](TECH_DESIGN.md).

Reply Core is one local process: a Node service (`core/src`) with one SQLite database, a native Swift helper for Apple-private sources, a web app served by the service (`core/ui`), and a signed macOS host app (`{reply}.app`) that starts it so macOS permissions belong to a named app. It runs on your Mac and nothing leaves it unless you press Send.

## Runtime flow

```text
loadConfig(env)                       fail fast: exit 78, the message names the setting
  -> mkdir REPLY_CORE_HOME (0700)     a home that cannot be used also exits 78
  -> logger                           pino, redaction list; to a rotated file when REPLY_CORE_LOG_FILE is set
  -> openDb                           migrations, quick_check; failure exits 74
  -> repo, identity, runner (+ names/groups/contacts hooks), scheduler, handoffs, sender, read, drafting, profile, status
  -> createServer                     Fastify: guards (Host, then Origin), uniform error envelope, one log line per response, routes, the web app
  -> listen 127.0.0.1:<port>          EADDRINUSE exits 75, anything else exits 1
  -> scheduler.start, daily backup schedule, pidfile
  -> SIGINT/SIGTERM                   stop scheduler and backups, remove pidfile, gracefulClose (5 s), close the database
```

The list of routes is in [CORE_API.md](CORE_API.md).

## Components

**Storage.** `core/src/storage/` owns the single SQLite database: `db.js` (open, pragmas, quick_check), `migrate.js` (forward-only checksummed migrations `0001`..`0013`), `repo.js` (message reads and writes). See [CORE_DATA_MODEL.md](CORE_DATA_MODEL.md).

**Connectors.** `core/src/connectors/` runs every source on one runtime (runner, scheduler, registry, error classes); `core/src/routes/sync.js` exposes `POST /api/sync/:connector`. Connectors only read: iMessage, Contacts, Apple Mail, WhatsApp (opt-in) and IMAP (TLS-only). A page may also carry chat names and group member lists, which the runner passes to the identity service in the same transaction as the messages and the cursor. See [CORE_CONNECTORS.md](CORE_CONNECTORS.md).

**Native helper.** Apple-private sources are read by `core/helper` (Swift, one binary, NDJSON on stdout, versioned by `schemaVersion`), which also stores IMAP app passwords in the keychain. Node calls it through `core/src/helper`, which verifies the binary's checksum, enforces a 30 s timeout (killing the whole process group), validates `schemaVersion` and maps exit codes to connector error codes. See [core/helper/README.md](../core/helper/README.md) and [CORE_PERMISSIONS.md](CORE_PERMISSIONS.md).

**Identity.** `core/src/identity/` holds handle normalization and the merge, unmerge and address-book import service; `core/src/routes/identity.js` exposes the merge endpoints. Merging is always an explicit user action. See [CORE_IDENTITY.md](CORE_IDENTITY.md).

**Read path.** `core/src/read/service.js` serves the UI: a contact-centric list (from `contact_summary`, with per-contact unread counts from `read_state`), a merged thread per contact (from `messages`) and full-text search (`messages_fts`). `core/src/routes/read.js` validates parameters, adds ETags to first pages, keeps everything else `no-store` and has the one small write, `POST /api/contacts/:id/read`. See [CORE_API.md](CORE_API.md).

**Profile.** `core/src/profile/service.js` and `core/src/routes/profile.js`: everything known about one person (address-book details, handles with counts, activity facts computed from the messages, group members, the profile fields and notes the user wrote). User-written data is part of what `rebuild` keeps.

**Sending and handoff.** `core/src/send/` (`service.js`, `drivers.js`, `uploads.js`) and `core/src/routes/send.js` send a message you write through Messages, Mail or WhatsApp Desktop with AppleScript, once per request, audited in `sends`; `REPLY_CORE_SENDING=off` disables it. `uploads.js` holds the files picked for a message (`<home>/outbox`); the WhatsApp connector's `confirmSent` checks that a WhatsApp message really arrived; `POST /api/consent` opens {reply}.app to ask macOS for permissions. `core/src/handoff/` and `routes/handoff.js` validate the recipient from the contact's own handles and build "open this app with my text" links (the alternative to sending). See [CORE_SENDING.md](CORE_SENDING.md) and [CORE_HANDOFF.md](CORE_HANDOFF.md).

**Drafting.** `core/src/drafting/service.js` builds one bounded prompt from a contact's thread and makes a single call to a local Ollama; `core/src/routes/drafts.js` serves the two endpoints. Off by default. See [CORE_DRAFTING.md](CORE_DRAFTING.md).

**Status.** `core/src/status/` builds one report of storage, helper and every source (`index.js`), with all operator wording in one catalog (`recovery.js`); `core/src/routes/status.js` serves `GET /api/status` and `POST /api/status/recheck`. See [CORE_STATUS.md](CORE_STATUS.md).

**Operations.** `core/src/ops/` implements backup (online snapshot, verification, retention), restore, rebuild (keeps manual merges, profile fields and notes), the daily backup schedule, the pidfile and the operation lock; `core/src/cli/ops.js` is the command line. `core/src/logfile.js` rotates the service log. See [CORE_OPERATIONS.md](CORE_OPERATIONS.md).

**IMAP accounts and secrets.** `core/src/imap/` holds the accounts file, the TLS-only IMAP client and the keychain wrapper; `core/src/cli/accounts.js` and `core/bin/reply-core.js` are the `accounts` command. See [CORE_SECURITY.md](CORE_SECURITY.md).

**Web app.** `core/ui` is a separate React and TypeScript package built only from the GDS design system; the service hosts its build (`core/src/server.js`: static files, client-route fallback, strict CSP). See [CORE_UI.md](CORE_UI.md) and [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

**Launcher and host app.** `core/scripts/reply-core` starts, stops and inspects the service and installs the optional login agent; `core/src/launcher/lib.js` holds its testable logic. `core/app/` builds and signs `~/Applications/{reply}.app` (`ReplyHost.swift`, `build-app.sh`, entitlements), the program macOS permissions are granted to and which asks for them (`--consent`, `--consent-send`). `core/scripts/verify-release.js`, `release-smoke.js` and `audit.js` are the release gate. See [CORE_OPERATIONS.md](CORE_OPERATIONS.md).

## Testing strategy

Unit and integration tests use `node:test`. Connectors are tested against deterministic synthetic copies of the source databases built by `core/test/fixtures` (see its README for the edge cases each source includes). The user interface is tested in a real browser against the real service with Playwright (`core/ui/e2e`), with the GDS accessibility gate in light, dark and at 375 px, in Chrome and in Playwright's WebKit (Safari's engine), and on GitHub Actions for every pull request (`.github/workflows/ci.yml`); the service in those tests uses the `fake` send driver, so no test can send a message. The only checks that need a real Mac profile are the manual real-data checks listed in [KNOWN_ISSUES.md](KNOWN_ISSUES.md). `npm run verify` is the everyday gate and `npm run verify:release` the release gate (both in [CORE_OPERATIONS.md](CORE_OPERATIONS.md)).

## Ownership

| File | Responsibility |
|---|---|
| `core/src/index.js` | Process entry: config, storage, wiring, listen, scheduler, backups, pidfile, signals, exit codes |
| `core/src/config.js` | Typed configuration and validation |
| `core/src/logger.js`, `logfile.js` | pino instance and redaction list; size-rotated log file |
| `core/src/errors.js` | `AppError` and the error envelope |
| `core/src/server.js` | Fastify instance, guards, error handlers, static web app, `gracefulClose` |
| `core/src/routes/*` | HTTP routes: health, sync, identity, read, profile, send, handoff, drafts, status |
| `core/src/storage/*` | Database, migrations, repository (see CORE_DATA_MODEL.md) |
| `core/src/connectors/*` | The connectors themselves and the runner, scheduler, registry, error classes (see CORE_CONNECTORS.md) |
| `core/src/identity/*` | Handle normalization, merge/unmerge, address-book import, chat names, group members (see CORE_IDENTITY.md) |
| `core/src/read/*` | Read model (list, thread, search, unread) |
| `core/src/profile/*` | Contact profile, profile fields, notes |
| `core/src/send/*` | Sending drivers and service (see CORE_SENDING.md) |
| `core/src/handoff/*` | Reply handoff links and audit (see CORE_HANDOFF.md) |
| `core/src/drafting/*` | Optional local-model reply suggestion (see CORE_DRAFTING.md) |
| `core/src/status/*` | Status report and recovery catalog (see CORE_STATUS.md) |
| `core/src/ops/*`, `core/src/cli/ops.js` | Backup, restore, rebuild, daily backup, pidfile, user-state export (see CORE_OPERATIONS.md) |
| `core/src/imap/*`, `core/src/cli/accounts.js` | IMAP accounts, client, keychain wrapper |
| `core/src/helper/*`, `core/helper/` | Node wrapper around the native helper; the Swift package `reply-core-helper` |
| `core/src/launcher/*`, `core/scripts/reply-core` | Launcher logic and command line |
| `core/app/` | The signed `{reply}.app` host |
| `core/scripts/*` | Release gate, audit, scale check, maintenance scripts (`db-inspect`, `reset-cursor`, `identity-reset`) |
| `core/ui/` | The web app (GDS only): shell, routes, API client; built to `core/ui/dist` |

New routes and services are registered in `server.js` and `index.js`. They must not change the conventions below (config, error envelope, logging redaction, guards) without updating this document.

## Conventions

- Plain ESM JavaScript on Node >= 20.17, no TypeScript build for the server.
- Errors: throw `AppError(status, code, message, { retryable })`; never put message content or personal data in `message`.
- Logs: ids, counts, codes, durations only.
- Tests: `node:test`, files in `core/test/*.test.js`, run with `npm test`.
- Loopback only: no feature may bind another interface.
- Other apps' databases are read-only; merging people and sending messages are explicit user actions.

## Deliberate deviations from the original design

- The default allowed origins are not a configured list: the service's own origins (`http://127.0.0.1:<port>` and `http://localhost:<port>`) are derived from the socket's real port, which is equivalent on the default port and also works on ephemeral test ports. `REPLY_CORE_ALLOWED_ORIGINS` only adds extra origins.
- `fastify` uses `LogController` to turn off its own request logging (the `disableRequestLogging` option is deprecated and would violate the zero-warning rule); the service logs one line per response itself.
- The original plan had no sending ("handoff only"); sending through the user's own apps was added once the read side was proven, with the safeguards in [CORE_SENDING.md](CORE_SENDING.md).
