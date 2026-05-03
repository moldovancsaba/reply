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
cd app/reply-app && ./build-bundle.sh
cd app/reply-app && ./install-bundle.sh
```

- `make run` starts the hub in the active user session from `chat/server.js` so Apple-private sources remain readable.
- `make stop` stops the hub process and unloads any legacy LaunchAgent if present.
- `make status` checks the session hub, any legacy LaunchAgent, and `{reply}` health.
- `app/reply-app/install-bundle.sh` is the only accepted local install/update path for `/Applications/reply.app`. Do not replace the app with ad hoc `cp`/partial bundle copy commands.
- `app/reply-app/build-icon.sh` must stay deterministic and local-only. Do not rebuild the app icon through Quick Look, browser screenshots, or any external asset pipeline.

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
- Native app updates must verify bundle integrity after install. Minimum required paths: `Contents/Info.plist`, `Contents/MacOS/reply`, `Contents/Resources/reply runtime`, `Contents/Resources/reply.icns`, and `Contents/Resources/reply-core`.
- Native app updates must also refresh LaunchServices registration and the Dock after install so icon metadata is re-read from the repaired bundle.
