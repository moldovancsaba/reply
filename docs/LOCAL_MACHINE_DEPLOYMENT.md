# Local Machine Deployment

`{reply}` runs locally as a session-owned Node hub plus a managed background worker.

The repository now also includes a native shell MVP at `app/reply-app`. That shell launches as `reply.app`, embeds the existing {reply} web UI, and provides a native system/runtime screen. The current shell is development-distributed from this repo; packaged installation/notarization is a separate track.

## Requirements

- macOS
- Node.js 20+
- Ollama running locally for drafting and refinement
- Run the hub in the active user session (`make run`) if you want iMessage sync
- Mail.app configured locally if you want native Apple Mail sync
- Calendar automation approval if you want Apple Calendar sync
- OpenClaw only if you want WhatsApp routing

## Start

```bash
make run
make status
```

Native shell MVP:

```bash
make run-app
```

This builds `app/reply-app/dist/reply.app` and launches it. The app can connect to an already-running `{reply}` runtime or start/stop/restart it from the native shell.

When the runtime is launched from `reply.app`, it now uses app-owned paths:

- data: `~/Library/Application Support/reply`
- logs: `~/Library/Logs/reply`

The first run on the app-owned path performs a best-effort migration from the legacy repo-local `chat/data` directory so existing local state is preserved.

The local hub writes logs to:

- `~/Library/Logs/reply/hub.log`
- `/tmp/reply-hub.log`

Default health endpoint:

- `http://127.0.0.1:45311/api/health`

## Apple Integrations

### iMessage

Reads `~/Library/Messages/chat.db` by default. If the hub reports `SQLITE_CANTOPEN` or preflight shows the DB is not readable:

1. Grant Full Disk Access to the runtime binary used by `{reply}`.
2. Restart the service with `make run`.
3. Optionally point `REPLY_IMESSAGE_DB_PATH` at a readable `chat.db`.

The current packaged app uses the protected-data helper:

- `app/reply-app/dist/reply.app/Contents/Helpers/reply-helper`

### Apple Mail

If Gmail OAuth is stale, {reply} now falls back to Mail.app automatically. Keep Mail.app configured with the local account you want to ingest.

### Apple Calendar

Calendar sync uses AppleScript. If it times out, grant Calendar automation access to the host process and retry:

```bash
curl -X POST http://127.0.0.1:45311/api/sync-calendar
```

### Apple Notes

Notes sync uses AppleScript and stores note content in LanceDB plus the unified message store.

## Troubleshooting

- If `make status` shows `imessage_source` degraded, macOS privacy is still blocking the runtime process.
- If `calendar` is stuck or errors, re-run the sync after approving Calendar automation.
- If `mail` fails through Gmail, {reply} will continue through Mail.app when available.
- If `openclaw_gateway` is degraded, WhatsApp routing is unavailable but the hub still runs.
