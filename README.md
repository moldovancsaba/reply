<p align="center">
  <img src="public/favicon.svg" alt="{reply} logo" width="140" />
</p>

<h1 align="center">{reply}</h1>
<p align="center"><strong>A local-first macOS communication workspace with a native shell, a Node hub, and a Trinity-backed drafting runtime.</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.5.14-2563EB?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/platform-macOS%2015%2B-0F172A?style=for-the-badge" alt="Platform">
  <img src="https://img.shields.io/badge/runtime-Node%20%7C%20Swift%20%7C%20Python-0EA5E9?style=for-the-badge" alt="Runtime">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#dependencies">Dependencies</a> •
  <a href="#installation">Installation</a> •
  <a href="#current-runtime-shape">Current Runtime Shape</a>
</p>

## Product Overview

`{reply}` is a macOS-first local communication operating system for a single human operator.

It does four things:

1. ingests local and connected communication sources
2. assembles message-backed conversations and contact context
3. drafts replies through `{trinity}`
4. executes final sends through the correct local transport

The live product boundary is now explicit:

- `{reply}` owns ingestion, local product workflow, conversation assembly, transport execution, and send-policy gates
- `{trinity}` owns live drafting, ranking, policy application, trace export, and training-bundle export
- `{train}` stays offline and bounded, learning policy artifacts from exported bundles only

Canonical docs:

- [REPLY_OVERVIEW.md](/Users/Shared/Projects/reply/REPLY_OVERVIEW.md)
- [docs/TRINITY_INTEGRATION_SPINE.md](/Users/Shared/Projects/reply/docs/TRINITY_INTEGRATION_SPINE.md)
- [docs/POLICY_LOOP_REPO_BREAKDOWN.md](/Users/Shared/Projects/reply/docs/POLICY_LOOP_REPO_BREAKDOWN.md)

## What Changed Recently

This README now reflects the current product state, including:

- live drafting runtime is `{trinity}` only in production paths
- legacy drafting is no longer a live fallback and survives only as developer-only shadow comparison behavior
- structured draft outcomes now go to `/api/trinity/outcome` instead of piggybacking on generic feedback logs
- runtime failures are operator-safe and no longer expose Docker, Colima, socket, or raw substrate errors in normal UI surfaces
- the conversation sidebar is driven by the unified message store rather than being hard-gated by `contacts.db`
- thread loading now preloads the first 20 and last 20 messages, then fills the history gap incrementally in the background
- message threads now render explicit left/right sent-versus-received rows instead of one undifferentiated feed
- native sync triggers now send the same protected approval payload/header shape as the web app, so per-source sync actions can start background work from the native shell
- native shell expectations are now first-class: `reply.app` is the operator shell, the hub/runtime sit behind it

## Quick Start

Repository bootstrap:

```bash
git clone https://github.com/your-org/reply.git
cd reply/chat
npm install
cd ..
make run
```

Optional native shell:

```bash
make run-app
```

Open:

- product UI or embedded hub: `http://127.0.0.1:45311/`
- health: `http://127.0.0.1:45311/api/health`

## Dependencies

Required local platform dependencies:

- macOS 15+
- Xcode / Swift 6 toolchain for `app/reply-app`
- Node.js `>=20.17.0`
- Python `>=3.12` for the local `{trinity}` runtime CLI
- Full Disk Access for the runtime host process if you want iMessage ingestion

Required repo/runtime dependencies:

- `chat/package.json`
  - `@lancedb/lancedb`
  - `@xenova/transformers`
  - `dompurify`
  - `dotenv`
  - `imapflow`
  - `libphonenumber-js`
  - `mailparser`
  - `mbox-reader`
  - `ollama`
  - `playwright`
  - `sqlite3`
- `app/reply-app/Package.swift`
  - native shell and protected-data helper

Required sibling runtime dependency:

- `{trinity}` repository available either:
  - at `/Users/Shared/Projects/trinity`
  - via `TRINITY_REPO_ROOT`
  - via `TRINITY_RUNTIME_ROOT`
  - or bundled into `reply/trinity-runtime`

Optional external tools:

- `Ollama` for local drafting/ranking model routes
- `OpenClaw` for WhatsApp transport and gateway control
- Mail.app configured locally for Apple Mail fallback paths

## Installation

The full local install and operator runbook is in [docs/LOCAL_MACHINE_DEPLOYMENT.md](/Users/Shared/Projects/reply/docs/LOCAL_MACHINE_DEPLOYMENT.md).

Short version:

### 1. Install dependencies

```bash
cd /Users/Shared/Projects/reply/chat
npm install
```

Install and prepare `{trinity}`:

```bash
cd /Users/Shared/Projects/trinity
uv sync --dev
```

### 2. Configure environment

```bash
cd /Users/Shared/Projects/reply/chat
cp .env.example .env
```

Important environment knobs:

- `PORT=45311`
- `TRINITY_REPO_ROOT=/Users/Shared/Projects/trinity`
- `TRINITY_PYTHON_BIN=/opt/homebrew/bin/python3.12` or another Python 3.12+ binary
- `OLLAMA_HOST=http://127.0.0.1:11434`

### 3. Start required local services

If using Ollama:

```bash
ollama serve
```

If using WhatsApp transport:

```bash
openclaw channels login --channel whatsapp
```

### 4. Start `{reply}`

Foreground session mode:

```bash
make run
```

Native shell:

```bash
make run-app
```

## Current Runtime Shape

### Product shell

- native macOS app: `app/reply-app`
- session-owned hub: `chat/server.js`
- background worker and local ingestion sidecars behind the hub

### Drafting runtime

- live drafting goes through `chat/brain-runtime.js`
- `{trinity}` is the only live drafting runtime in normal product mode
- developer-only `trinity-shadow` mode exists for comparison against legacy output
- accepted artifact provenance is carried through draft context, outcomes, traces, and training bundles

### Conversation model

- dashboard source cards report raw ingestion counts
- sidebar conversations come from the unified message store and conversation index
- contact rows enrich conversations when available, but valid message-backed handles are no longer hidden when `contacts.db` lacks a profile row
- thread views now preload both ends of the conversation window:
  - first 20 messages by oldest order
  - last 20 messages by newest order
- if there is a history gap between those windows, the app fills it incrementally without blocking the UI

### Feedback and outcomes

- structured draft outcomes: `/api/trinity/outcome`
- generic operator notes and freeform logs: `/api/feedback` and `/api/feedback/log`
- trace export and training-bundle promotion stay explicit, versioned, and replayable

## Development Commands

Hub and native shell:

```bash
make run
make stop
make status
make doctor
make run-app
make build-app
```

Node checks:

```bash
cd chat
npm test
npm run lint
```

Useful runtime checks:

```bash
npm run verify:openclaw
curl http://127.0.0.1:45311/api/health
curl http://127.0.0.1:45311/api/system/health
```

## Architecture Notes

Current high-level split:

- conversation assembly, transport, safety, and operator UX remain in `{reply}`
- candidate generation, refinement, evaluation, ranking, and artifact application live in `{trinity}`
- offline policy learning and eval live in `{train}`

Additional docs:

- [docs/ARCHITECTURE.md](/Users/Shared/Projects/reply/docs/ARCHITECTURE.md)
- [docs/DEPENDENCY_MAP.md](/Users/Shared/Projects/reply/docs/DEPENDENCY_MAP.md)
- [docs/LOCAL_MACHINE_DEPLOYMENT.md](/Users/Shared/Projects/reply/docs/LOCAL_MACHINE_DEPLOYMENT.md)
- [docs/HANDOVER.md](/Users/Shared/Projects/reply/docs/HANDOVER.md)

## Troubleshooting

- **Dashboard counts are high but the sidebar is tiny**: the current build now uses the unified message-backed conversation index rather than requiring a preexisting contact row. If the UI still shows stale results, reload the app so the `v5` conversation cache replaces older cached pages.
- **Thread history feels incomplete**: current behavior intentionally preloads both ends of the thread and loads the middle gap progressively. Scroll through the thread or use the history gap loader to fetch more without freezing the workspace.
- **`Local agent runtime is unavailable.`**: this now means a normalized local substrate failure, usually Docker/Colima or a sandbox runtime. Check the local runtime, not the drafting code.
- **`Reply drafting runtime is unavailable.`**: check the local `{trinity}` runtime path, Python 3.12+, and model runtime health.
- **iMessage ingestion degraded**: grant Full Disk Access to the actual runtime host process and confirm `~/Library/Messages/chat.db` is readable.
- **WhatsApp transport degraded**: check `OpenClaw` and its gateway.

## Contributing

1. Track work in [`moldovancsaba/reply` issues](https://github.com/moldovancsaba/reply) and [docs/EXECUTION_BACKLOG.md](/Users/Shared/Projects/reply/docs/EXECUTION_BACKLOG.md).
2. Keep product, runtime, and learning boundaries explicit.
3. Run tests and syntax checks before shipping.
4. Update the canonical docs when runtime contracts, install steps, or operator-visible behavior change.

## License

Provided "as-is" for local-first operator workflows and localhost ecosystem routing.
