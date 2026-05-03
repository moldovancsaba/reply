# Local Machine Deployment

This is the canonical install and operator runbook for `{reply}` on one macOS machine.

It now covers:

- the native `reply.app` shell
- the Node hub
- the local `{trinity}` drafting runtime
- local model dependencies
- OpenClaw transport dependencies
- current app-owned data and log paths

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
- `~/Library/Application Support/reply/shadow/trinity-draft-comparisons.jsonl`
- `~/Library/Logs/reply/hub.log`
- `/tmp/reply-hub.log`

Default HTTP health endpoint:

- `http://127.0.0.1:45311/api/health`

## Current Runtime Notes

### Drafting runtime

- live drafting is `{trinity}` only
- legacy drafting is not part of the normal live path
- developer-only `trinity-shadow` mode exists for comparison logging
- structured draft outcomes are posted to `/api/trinity/outcome`

### Conversation assembly

- dashboard message counts come from ingestion totals
- conversation sidebar now comes from the unified message-backed index
- a missing contact row no longer hides a valid message-backed conversation
- thread views preload both the oldest 20 and newest 20 messages on first open
- long threads fill the middle history gap incrementally in the background
- sent and received messages render as explicit right/left rows

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

```bash
curl http://127.0.0.1:45311/api/health
curl http://127.0.0.1:45311/api/system/health
```

```bash
cd /Users/Shared/Projects/reply/chat
npm test
npm run lint
```

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
