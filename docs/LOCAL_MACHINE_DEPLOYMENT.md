# Local Machine Deployment

This is the canonical install and operator runbook for `{reply}` on one macOS machine.

It now covers:

- the native `reply.app` shell
- the Node hub
- the local `{trinity}` drafting runtime
- local model dependencies
- OpenClaw transport dependencies
- current app-owned data and log paths

For the full bidirectional app/service inventory and the latest audited health snapshot, see:

- [RELATION_AUDIT.md](/Users/Shared/Projects/reply/docs/RELATION_AUDIT.md)

## Target Environment

Required:

- macOS 15+
- Xcode / Swift 6 toolchain
- Node.js `>=20.17.0`
- Python `>=3.12`
- `npm`

Optional but commonly required:

- `uv` for `{trinity}` development setup
- `Ollama`
- `OpenClaw`

## Version Contract

Current documented versions for this deployment guide:

- `{reply}` package: `0.5.15`
- native shell platform target: `macOS 15+`
- Node.js: `>=20.17.0`
- Python for `{trinity}`: `>=3.12`
- Swift toolchain: `Swift 6`

## Repository Layout

Expected local checkout roots:

- `{reply}`: `/Users/Shared/Projects/reply`
- `{trinity}`: `/Users/Shared/Projects/trinity`

`{reply}` resolves the drafting runtime in this order:

1. `TRINITY_RUNTIME_ROOT`
2. `TRINITY_REPO_ROOT`
3. bundled `reply/trinity-runtime`
4. sibling repo `../trinity`

## Install

### 1. Install Node dependencies

```bash
cd /Users/Shared/Projects/reply/chat
npm install
```

### 2. Install `{trinity}` runtime dependencies

```bash
cd /Users/Shared/Projects/trinity
uv sync --dev
```

If you are not using `uv`, make sure a Python 3.12+ interpreter exists and that the `{trinity}` core package is importable from its repo root.

### 3. Configure environment

```bash
cd /Users/Shared/Projects/reply/chat
cp .env.example .env
```

Minimum recommended local overrides:

```bash
PORT=45311
TRINITY_REPO_ROOT=/Users/Shared/Projects/trinity
TRINITY_PYTHON_BIN=/opt/homebrew/bin/python3.12
OLLAMA_HOST=http://127.0.0.1:11434
```

### 4. Prepare macOS permissions

If you want Apple-private data:

- grant Full Disk Access to the actual host process used by `{reply}`
- approve Calendar automation if using Apple Calendar sync
- keep Mail.app configured locally if relying on Apple Mail fallback behavior

### 5. Prepare optional services

Ollama:

```bash
ollama serve
```

OpenClaw:

```bash
openclaw channels login --channel whatsapp
```

## Run Modes

### Foreground session mode

Recommended for development and any path that needs Apple-private reads:

```bash
cd /Users/Shared/Projects/reply
make run
make status
```

### Native shell

```bash
cd /Users/Shared/Projects/reply
make run-app
```

This builds and launches:

- `app/reply-app/dist/reply.app`

Launch hardening notes:

- the bundled native shell starts the hub on preferred local ports `45431` through `45446`
- `script/build_and_run.sh --verify` now waits for `/api/health` readiness, not just a visible process
- the native UI stays in a startup state until the hub reports launch readiness
- use `app/reply-app/install-bundle.sh` when you need to install or refresh `/Applications/reply.app`

### Legacy LaunchAgent mode

Still available if you explicitly want it:

```bash
make install-service
make uninstall-service
```

Use `make doctor` if the repo root moved or the plist points at stale paths.

## Runtime Paths

App-owned local paths:

- data: `~/Library/Application Support/reply`
- logs: `~/Library/Logs/reply`

Current notable files:

- `~/Library/Application Support/reply/chat.db`
- `~/Library/Application Support/reply/contacts.db`
- `~/Library/Application Support/reply/settings.json`
- `~/Library/Application Support/reply/channel_bridge_pending.json`
- `~/Library/Application Support/reply/channel_bridge_events.jsonl`
- `~/Library/Application Support/reply/shadow/trinity-draft-comparisons.jsonl`
- `~/Library/Application Support/reply/mail_sync_status.json`
- `~/Library/Logs/reply/hub.log`
- `/tmp/reply-hub.log`

Default HTTP health endpoint:

- `http://127.0.0.1:45311/api/health`
- `http://127.0.0.1:45311/api/system/health`

Bundled native-shell preferred health endpoints:

- `http://127.0.0.1:45431/api/health`
- through
- `http://127.0.0.1:45446/api/health`

## Current Runtime Notes

### Drafting runtime

- live drafting is `{trinity}` first
- if `{trinity}` `suggest` fails or times out, `{reply}` falls back to bounded local drafting
- legacy drafting is not part of the normal operator path except developer shadow comparison
- developer-only `trinity-shadow` mode exists for comparison logging
- structured draft outcomes are posted to `/api/trinity/outcome`

### Channel bridge and LinkedIn runtime

- LinkedIn defaults to `browser_bridge`
- Playwright sidecar mode exists, but it is explicit-only
- inbound bridge writes are bounded against `chat.db`
- when `chat.db` is busy, bridge messages are queued in `channel_bridge_pending.json`
- queued bridge writes are replayed by the background worker under a dedicated outbox lock
- bridge replay reconciles against `unified_messages` before retrying, so already-persisted rows are removed from the queue

### Conversation assembly

- dashboard message counts come from ingestion totals
- conversation sidebar now comes from the unified message-backed index
- conversation sidebar can also merge vector-backed conversation stats for channels that are not mirrored into `unified_messages`
- a missing contact row no longer hides a valid message-backed conversation
- contact merge and unmerge remain manual user actions only; the runtime does not auto-merge identities
- composer channels now come from `conversation_channel_capabilities`, not from handle heuristics
- thread views preload both the oldest 20 and newest 20 messages on first open
- long threads fill the middle history gap incrementally in the background
- sent and received messages render as explicit right/left rows
- `/api/thread` now retries canonical conversation rebuild before using the legacy `unified_messages` compatibility path

### Mail ingestion

Current mail ingestion order:

1. Gmail OAuth connector
2. IMAP accounts
3. Apple Mail fallback

Important operator notes:

- if Gmail returns `invalid_grant`, reconnect Gmail in settings or rely on Apple Mail fallback
- Apple Mail fallback now reads through the bundled `reply-helper`, not directly from the Node worker
- Apple Mail fallback normalizes sender/recipient addresses into `mailto:` conversation handles
- Full Disk Access onboarding should target `/Applications/reply.app/Contents/Helpers/reply-helper`

### Failure handling

Normal operator UI surfaces now receive normalized product-safe errors such as:

- `local_sandbox_unavailable`
- `trinity_runtime_unavailable`
- `openclaw_unavailable`
- `local_model_runtime_unavailable`

Raw Docker socket paths, Colima errors, and similar substrate details stay in logs.

### Native sync actions

Current behavior:

- sync triggers from the native shell are protected POST routes
- they now send explicit approval headers and approval payloads
- a successful trigger means the sync started in the background, not that it already completed

## Validation

Recommended checks:

```bash
cd /Users/Shared/Projects/reply
make status
```

Additional relation checks:

```bash
cd /Users/Shared/Projects/reply/chat
npm run verify:openclaw
npm run verify:trinity-train
```

Current health endpoint aliases on the hub:

- `/api/health`
- `/api/system-health`
- `/api/system/health`
- `/api/system/services`

```bash
curl http://127.0.0.1:45311/api/health
curl http://127.0.0.1:45311/api/system-health
curl http://127.0.0.1:45311/api/system/health
cat ~/Library/Application\\ Support/reply/channel_bridge_pending.json
```

```bash
cd /Users/Shared/Projects/reply/chat
npm test
npm run lint
npm run audit:conversations
npm run verify:trinity-train
```

`npm run verify:trinity-train` should pass before release-oriented validation if this machine has the sibling `{trinity}` runtime available. It proves the live drafting, outcome recording, trace export, and bounded `{train}` handoff path instead of only unit-level behavior.

## Troubleshooting

### iMessage reads fail

Symptoms:

- `SQLITE_CANTOPEN`
- `imessage_source` degraded
- empty or partial iMessage sync despite local messages existing

Actions:

1. grant Full Disk Access to the runtime host process
2. restart `{reply}`
3. optionally set `REPLY_IMESSAGE_DB_PATH`

### `{trinity}` runtime unavailable

Symptoms:

- suggest endpoints return `Reply drafting runtime is unavailable.`

Actions:

1. verify `/Users/Shared/Projects/trinity` exists or `TRINITY_REPO_ROOT` is set
2. verify Python 3.12+
3. run `uv sync --dev` in `{trinity}`
4. check Ollama if model-backed routes are enabled

### Mail conversations missing

Symptoms:

- dashboard shows mail activity but the sidebar has no email threads
- `mail_sync_status.json` reports idle or stale progress

Actions:

1. inspect `~/Library/Application Support/reply/mail_sync_status.json`
2. reconnect Gmail if the connector reports `invalid_grant`
3. if Gmail is unavailable, make sure Mail.app is configured and allowed for AppleScript automation
4. restart `{reply}` after a mail sync path change so the conversation index refreshes from the live runtime

### Sandbox / Docker / Colima failures

Symptoms:

- suggest endpoints return `Local agent runtime is unavailable.`

Actions:

1. start Docker or Colima
2. start the required local sandbox runtime
3. retry the operator action

### WhatsApp unavailable

Symptoms:

- `openclaw_unavailable`
- WhatsApp source visible but outbound unavailable

Actions:

1. start OpenClaw
2. verify gateway health
3. re-run `openclaw channels login --channel whatsapp` if needed

### Sidebar still shows too few conversations

The current build fixed the backend gating bug. If the UI still shows the older tiny list:

1. reload the app or page
2. let the refreshed `reply.conversations.v5.*` cache replace stale cached pages

### Native sync cards show trigger failures

The current build fixes the native trigger path so it matches the protected-route contract.

If a card still fails:

1. confirm the hub is reachable from `reply.app`
2. confirm the protected route is not returning operator-token or approval errors
3. check the specific source’s runtime permissions or connector health after the trigger starts

## Related Docs

- [README.md](/Users/Shared/Projects/reply/README.md)
- [ARCHITECTURE.md](/Users/Shared/Projects/reply/docs/ARCHITECTURE.md)
- [DEPENDENCY_MAP.md](/Users/Shared/Projects/reply/docs/DEPENDENCY_MAP.md)
- [HANDOVER.md](/Users/Shared/Projects/reply/docs/HANDOVER.md)
