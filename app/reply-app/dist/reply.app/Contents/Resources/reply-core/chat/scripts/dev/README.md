# Dev-only scripts (`chat/scripts/`)

These Node entrypoints are **not** used by the hub, worker, or UI. They exist for manual reproduction of edge cases (LinkedIn handles, bridge ingest, Lance paths).

Run from the **`chat/`** directory so relative imports resolve:

```bash
cd chat
node scripts/dev/repro-space.js
node scripts/dev/repro-case.js
node scripts/dev/repro-linkedin.completed.js
```

See also: hub logging policy in [`READMEDEV.md`](../../../READMEDEV.md#hub-logging-reply_debug) (`REPLY_DEBUG`).
