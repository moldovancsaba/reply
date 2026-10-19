# Reply Core Operations

Status: living document, owned by issue #197; the launcher issue (#206) adds start, stop and log sections.

Reply Core's database is a cache of your other apps, **except** for one thing it cannot get back from them: the merges you made yourself. Everything here exists so that a damaged or outdated database never costs you those decisions, and recovery is a command, not an investigation.

All commands run from `core/`: `node bin/reply-core.js <command>`. Exit codes: `0` ok, `2` usage, `3` Reply Core is running or another operation is, `4` verification failed, `5` I/O error.

## Start, stop and status

The launcher is `core/scripts/reply-core` (run it as `node scripts/reply-core ...` or `npm run launcher -- ...` from `core/`, or put a symlink to it on your PATH as `reply-core`).

| Command | What it does |
|---|---|
| `start [--background] [--no-open]` | checks Node (>= 20.17), builds the web app if `ui/dist` is missing, starts the service, waits up to 30 s for `/api/health`, then opens **Safari** (set `REPLY_CORE_BROWSER` to another app name, or `default` for the system default browser; on **Sources** when something needs attention, otherwise the inbox). Without `--background` it stays attached (Control+C stops it); with it the service keeps running and the pidfile is used. A second `start` only opens the browser. |
| `stop` | SIGTERM to the pid in `reply-core.pid`, waits 5 s, then SIGKILL. |
| `status` | the same data as `GET /api/status` as a short table (storage, helper, each source, backups); exit 1 when overall is `blocked`. |
| `open` | opens the UI of the running service. |
| `logs [--lines N] [--no-follow]` | tails the service log. |
| `install-agent`, `uninstall-agent` | see below. |

Exit codes: `0` ok, `10` Node too old, `11` the web app could not be built (needs network and a `GITHUB_TOKEN`, see `core/ui/README.md`), `12` the service did not become healthy in 30 s, `13` not running (`stop`, `status`, `open`); when the service itself refuses to start the launcher passes its code on and explains it (`75` port in use, `78` invalid configuration, `74` storage). A pidfile whose process is gone is ignored. Single user, single instance: two accounts on one Mac need different `REPLY_CORE_PORT` values.

## Start at login (optional)

`install-agent` writes `~/Library/LaunchAgents/com.moldovancsaba.reply-core.plist` and loads it: `RunAtLoad`, `KeepAlive`, `ThrottleInterval 30`, `ProcessType Background`, running exactly `<this node> core/src/index.js`. Installing again rewrites and reloads it (nothing is duplicated). `uninstall-agent` unloads it and deletes that one file, and only if it carries the marker the installer wrote; a plist it did not create is never touched. Logs and data stay.

**Full Disk Access is attached to the program that starts the service**, here the exact `node` binary named in the plist (the command prints its path and the System Settings steps). Consequences: after a Node upgrade (a new path or binary) the agent loses access, so run `install-agent` again and grant it again; `status` says when the agent was installed for a different Node. The alternative without an agent is to run `start` from a Terminal that already has Full Disk Access. The plist contains paths and the port only, never a secret.

## Logs

The launcher and the agent set `REPLY_CORE_LOG_FILE=~/Library/Logs/reply-core/service.log`. The service rotates it itself at `REPLY_CORE_LOG_MAX_BYTES` (default 10 MB) and keeps 5 files (`service.log`, `.1` ... `.4`), so the total stays under about 50 MB, with no root-owned `newsyslog` file and no blocking (a rotation is a few renames between two small writes). If the file cannot be written the service logs to stderr instead. Two small extra files exist: `startup.log` (output of `start --background`) and `launchd.log` (what launchd captured before the logger was ready, for example an invalid configuration); both only ever hold startup problems. Logs contain ids, counts and error codes, never message text or addresses.

## Release gate

`npm run verify:release` (from `core/`) runs everything that must hold before a build is handed to someone, and prints a table: lint with no warnings, the Swift helper build and tests (skipped with a note if there is no Swift toolchain), the unit and integration tests, an end-to-end smoke of the launcher (start, health, status, app shell, second start, stop, in a temporary HOME), and the UI package's own `verify` (lint, types, unit tests, build, bundle budget, Playwright accessibility). It runs every step even after a failure and exits non-zero on any failure **or any warning** in any step's output. Unlike `npm run verify`, missing UI dependencies are a failure.

## Backups

```bash
node bin/reply-core.js backup [--label name]    # snapshot now (safe while Reply Core is running)
node bin/reply-core.js backups list
```

A backup is a consistent snapshot made with SQLite's online backup API, checked (`quick_check`) before it is kept, stored as a single file `REPLY_CORE_HOME/backups/core-<UTC time>.db` (folder `0700`, file `0600`), with the matching `user-state-<UTC time>.json` next to it.

- **Automatic**: the service makes one backup per day, at the first check at or after 03:00 local time on a day that has none. A failure is retried once after 10 minutes, then recorded (`lastBackupError` in `GET /api/status`) and left for the next day. A backup is also taken before every database migration (`core.db.bak-<version>`, last three kept).
- **Retention**: the newest backup of each of the **7 most recent days**, plus the newest of each of the **4 most recent weeks** before that (UTC days and ISO weeks). Backups with a `--label` (such as `pre-rebuild`) are never pruned.
- **Not encrypted** beyond FileVault, and they hold all your message text: keep `backups/` out of anything you share.

## Restore

```bash
# stop Reply Core first
node bin/reply-core.js restore ~/Library/Application\ Support/reply-core/backups/core-20261018T030000Z.db --dry-run
node bin/reply-core.js restore ~/Library/Application\ Support/reply-core/backups/core-20261018T030000Z.db
```

`restore` verifies the file (`quick_check`, schema version, migration checksums), copies it next to `core.db`, then swaps it in. **The replaced database is kept** as `core.db.replaced-<time>`. At every step either the old or the new database is in place, never a mixture. A backup from an older version is migrated forward on the next start; one from a **newer** version is refused ("update Reply Core first"). Only files in the `backups/` folder are accepted unless `--allow-external` is given. `--dry-run` prints what would happen and changes nothing.

## Rebuild

```bash
# stop Reply Core first
node bin/reply-core.js rebuild --dry-run
node bin/reply-core.js rebuild
```

Starts a **new** database that contains only your manual merges. Everything else (messages, contacts) is imported again from your sources the next time Reply Core runs. Use it when the database is damaged beyond a restore, or to start clean without losing your merges.

What happens, in order: the merges are exported by handle sets (not row ids) → a `pre-rebuild` backup and the `user-state` JSON are written → a new database is built next to the old one and the merges are put in → the old file is renamed `core.db.replaced-<time>` and the new one becomes `core.db`. The old database is never deleted. An interrupted rebuild leaves the original usable; the half-built file is removed.

Merges whose people have not been imported yet (a source is blocked, for example) wait in `pending_merges` and are applied automatically as soon as **all** of their handles appear. Undone merges are not carried over.

Not carried over: the handoff audit and per-contact ids (they stay in the kept old file).

## Guards

Restore and rebuild refuse to run while Reply Core is running (exit 3, with the exact `kill <pid>` to stop it) and while another restore or rebuild is (a lock file whose owner is gone is replaced). The service writes `REPLY_CORE_HOME/reply-core.pid` (`{ pid, startedAt, port }`) while it runs and removes it on a clean exit; a stale file does not count.

## What to do when

| Situation | Do |
|---|---|
| `Reply Core: storage error (storage_corrupt)` at start | `backups list`, then `restore` the newest backup |
| A bad migration or a bug damaged data | `restore` a backup made before it |
| You want a clean start but keep your merges | `rebuild` |
| Connectors imported something wrong | stop the service, `node scripts/reset-cursor.js <connector> --purge` (see [CORE_CONNECTORS.md](CORE_CONNECTORS.md)) |
| Merges look wrong | `node scripts/identity-reset.js --to-auto` undoes them all ([CORE_IDENTITY.md](CORE_IDENTITY.md)) |

## Status

`GET /api/status` includes `backups`: `count`, `totalBytes`, `lastBackupAt`, and `lastBackupError` when the last attempt failed ([CORE_STATUS.md](CORE_STATUS.md)).
