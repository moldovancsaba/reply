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

## Ownership

| File | Responsibility |
|---|---|
| `core/src/config.js` | Typed configuration and validation |
| `core/src/logger.js` | pino instance and the redaction list |
| `core/src/errors.js` | `AppError` and the error envelope |
| `core/src/server.js` | Fastify instance, guards, error handlers, `gracefulClose` |
| `core/src/routes/health.js` | `GET /api/health` |
| `core/src/index.js` | Process entry: config, listen, signals, exit codes |

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
