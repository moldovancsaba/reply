# Reply Core Architecture

Status: living document, owned by issue #183 and extended by later Reply Core issues.
Program plan: [`../REPLY_CORE_PLAN.md`](../REPLY_CORE_PLAN.md).

## Runtime flow (service scaffold)

```text
process start
  -> loadConfig(env)                       fail fast: exit 78, message names the setting
  -> mkdir REPLY_CORE_HOME (0700)
  -> createLogger(config)                  pino, redaction list
  -> createServer(config, logger)          Fastify
       onRequest: guards                   Host check, then Origin check
       onResponse: one info log line       requestId, route, status, durationMs
       errorHandler / notFoundHandler      uniform ErrorEnvelope
       routes: GET /api/health
  -> listen(127.0.0.1:<port>)              EADDRINUSE -> exit 75
  -> SIGINT/SIGTERM -> gracefulClose(5 s)  stop accepting, finish in-flight, close idle keep-alive, then exit
```

## Storage

`core/src/storage/` owns the single SQLite database: `db.js` (open, pragmas, quick_check), `migrate.js` (forward-only checksummed migrations), `repo.js` (all reads and writes). The service opens storage after config and before listening; a storage failure exits with code 74. See [CORE_DATA_MODEL.md](CORE_DATA_MODEL.md).

## Connector framework

`core/src/connectors/` runs every source on one runtime (runner, scheduler, registry, error classes) and `core/src/routes/sync.js` exposes `POST /api/sync/:connector`. Flow, error codes and operations: [CORE_CONNECTORS.md](CORE_CONNECTORS.md).

## Read path

`core/src/read/service.js` serves the UI: a contact-centric list (from `contact_summary`), a merged thread per contact (from `messages`), and full-text search (`messages_fts`). `core/src/routes/read.js` validates parameters, adds ETags to first pages and keeps everything else `no-store`. Endpoints, cursors and ranking: [CORE_API.md](CORE_API.md).

## Identity

`core/src/identity/` holds handle normalization (`normalize.js`) and the merge/unmerge/import service (`service.js`); `core/src/routes/identity.js` exposes the merge endpoints. Rules, normalization table and API: [CORE_IDENTITY.md](CORE_IDENTITY.md).

## Native helper

Apple-private sources are read by `core/helper` (Swift, one binary, NDJSON on stdout, versioned by `schemaVersion`). Node calls it through `core/src/helper`, which verifies the binary's checksum, enforces a 30 s timeout (killing the whole process group), validates `schemaVersion`, and maps exit codes to connector error codes. See [`core/helper/README.md`](../core/helper/README.md) and [CORE_PERMISSIONS.md](CORE_PERMISSIONS.md).

## Testing strategy

Unit and integration tests use `node:test`. Connectors are tested against deterministic synthetic copies of the source databases built by `core/test/fixtures` (see its README for the edge cases each source includes). The only checks that need a real Mac profile are the manual real-data comparisons listed in each connector issue.

## Ownership

| File | Responsibility |
|---|---|
| `core/src/config.js` | Typed configuration and validation |
| `core/src/logger.js` | pino instance and the redaction list |
| `core/src/errors.js` | `AppError` and the error envelope |
| `core/src/server.js` | Fastify instance, guards, error handlers, `gracefulClose` |
| `core/src/routes/health.js` | `GET /api/health` |
| `core/src/storage/*` | Database, migrations, repository (see CORE_DATA_MODEL.md) |
| `core/src/connectors/*` | Connector runner, scheduler, registry, error classes (see CORE_CONNECTORS.md) |
| `core/src/read/*`, `core/src/routes/read.js` | Read model and HTTP read endpoints (see CORE_API.md) |
| `core/src/identity/*` | Handle normalization, merge/unmerge, address-book import (see CORE_IDENTITY.md) |
| `core/src/helper/*` | Node wrapper around the native helper (checksum, timeout, error mapping) |
| `core/helper/` | Swift package: `reply-core-helper` |
| `core/src/index.js` | Process entry: config, storage, listen, signals, exit codes |

Later issues add routes and services and register them in `server.js`. They must not change the conventions above (config, error envelope, logging redaction, guards) without updating this document.

## Conventions every Reply Core issue follows

- Plain ESM JavaScript on Node >= 20.17, no TypeScript build for the server.
- Errors: throw `AppError(status, code, message, { retryable })`; never put message content or personal data in `message`.
- Logs: ids, counts, codes, durations only.
- Tests: `node:test`, files in `core/test/*.test.js`, run with `npm test`; `npm run verify` is the gate.
- Loopback only: no feature may bind another interface.

## Deviations from issue #183

- The default allowed origins are not a configured list: the service's own origins (`http://127.0.0.1:<port>` and `http://localhost:<port>`) are derived from the socket's real port, which is equivalent on the default port and also works on ephemeral test ports. `REPLY_CORE_ALLOWED_ORIGINS` only adds extra origins.
- `fastify` uses `LogController` to turn off its own request logging (the `disableRequestLogging` option is deprecated and would violate the zero-warning rule); the service logs one line per response itself.
