# Reply Core

Lean, local-first unified inbox service. One Node process, loopback-only HTTP API. See [`../REPLY_CORE_PLAN.md`](../REPLY_CORE_PLAN.md) for the program and [`../docs/CORE_ARCHITECTURE.md`](../docs/CORE_ARCHITECTURE.md) for the runtime flow.

This directory is independent of `chat/` (the legacy hub); it shares nothing with it.

## Run

```bash
cd core
npm install
npm start
curl -s http://127.0.0.1:45511/api/health
```

Requires Node >= 20.17.

## Configuration

Every setting is optional. See [`.env.example`](.env.example). Values are read from the process environment once at start; invalid values stop the service immediately.

| Variable | Default | Meaning |
|---|---|---|
| `REPLY_CORE_HOME` | `~/Library/Application Support/reply-core` | Data home (created with mode 0700) |
| `REPLY_CORE_PORT` | `45511` | Loopback port, 1024-65535 |
| `REPLY_CORE_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `REPLY_CORE_ALLOWED_ORIGINS` | empty | Extra browser origins allowed to call the API (for example a UI dev server). The service's own origin is always allowed. |

Unknown `REPLY_CORE_*` variables are ignored and reported once at info level.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Clean shutdown |
| 75 | Port already in use (is Reply Core already running?) |
| 78 | Invalid configuration (the message names the setting) |

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
