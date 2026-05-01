# AGENTS.md

## Scope

- Root orchestration lives at the repo root.
- The Node app and most developer commands live in `chat/`.

## Verified Commands

### Root

```bash
make run
make stop
make status
make install-ReplyMenubar
make run-ReplyMenubar
```

- `make run` starts the hub in the active user session from `chat/server.js` so Apple-private sources remain readable.
- `make stop` stops the hub process and unloads any legacy LaunchAgent if present.
- `make status` checks the session hub, any legacy LaunchAgent, and `{reply}` health.

### chat/

```bash
cd chat
npm install
npm start
npm test
npm run lint
npm run lint:fix
npm run security:audit
npm run security:fix
npm run verify:openclaw
npm run linkedin:sync
npm run channel-bridge:ingest -- --event '{"channel":"telegram","peer":{"handle":"@alice"},"text":"hello"}'
```

- Tests use Node's built-in runner: `node --test test/*.test.js`.
- `npm run verify:openclaw` verifies the resolved local OpenClaw binary path.
- `channel-bridge:ingest` also supports `--dry-run` and `--batch` modes; see `docs/CHANNEL_BRIDGE.md` for examples.

## Verified Workflows

- Local startup is handled by `runbook/start.sh`, which runs the hub in the current user session.
- Full local stack shutdown is handled by `runbook/stop.sh`.
- Service health checks are centralized in `runbook/status.sh`.
- ReplyMenubar install/run entrypoints are maintained in the root `Makefile`.

## Known Notes

- `README.md` still references `npm run dev`, but `chat/package.json` currently has no `dev` script. Prefer `npm start` unless/until a real `dev` command is added.
