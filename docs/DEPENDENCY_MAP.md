# {reply} Dependency Map

**Doc freshness:** 2026-05-03  
**Purpose:** current runtime and install dependency map for `{reply}` after the Trinity runtime cutover and native-shell rollout.

This document is no longer a historical issue graph. It is the current dependency map for:

- local runtime prerequisites
- cross-repo dependencies
- product-layer boundaries
- operator-critical failure points

## Runtime Layers

### 1. Native shell

Owned by:

- `app/reply-app`

Depends on:

- macOS 15+
- Swift 6 / Xcode toolchain
- local hub availability on the configured localhost port

Provides:

- operator shell
- runtime controls
- local app-owned data/log path ownership

### 2. Hub and API layer

Owned by:

- `chat/server.js`
- `chat/routes/*`
- `chat/background-worker.js`

Depends on:

- Node.js `>=20.17.0`
- `chat/package.json`
- local writable app-support and log paths

Provides:

- conversation APIs
- sync APIs
- settings APIs
- draft and send APIs
- native connector status

### 3. Local product stores

Owned by:

- `chat.db`
- `contacts.db`
- `settings.json`
- LanceDB

Depends on:

- local filesystem
- SQLite
- LanceDB bindings

Provides:

- unified message corpus
- message-backed conversation index
- contact enrichment
- local settings
- semantic retrieval

### 4. Drafting runtime

Owned by:

- `{trinity}`

Resolved through:

1. `TRINITY_RUNTIME_ROOT`
2. `TRINITY_REPO_ROOT`
3. bundled `trinity-runtime`
4. sibling repo `../trinity`

Depends on:

- Python 3.12+
- `{trinity}` core package import path
- optional Ollama availability for model-backed routes

Provides:

- `reply-suggest`
- `reply-record-outcome`
- `reply-export-trace`
- `reply-export-training-bundle`
- policy acceptance, promotion, rollback, and shadow fixture tooling

### 5. Offline learning loop

Owned by:

- `{train}`

Depends on:

- exported `{trinity}` training bundles
- accepted artifact provenance
- replayable eval inputs

Provides:

- bounded tone learner
- bounded brevity learner
- bounded channel-formatting learner
- policy proposal and eval artifacts

## Product Boundary Dependencies

### `{reply}` owns

- ingestion and local sync orchestration
- message-backed conversation assembly
- contact/profile UX
- operator workflow and native shell
- send execution
- send-policy gates
- outbound verification
- human-approval constraints

### `{trinity}` owns

- candidate generation
- refinement
- evaluation and ranking
- behavior artifact application
- runtime trace persistence contract
- training-bundle export

### `{train}` owns

- offline bundle consumption
- bounded behavior optimization
- proposal artifact generation
- eval reporting

## Hard Dependencies

### Required for core product bring-up

- macOS
- Node.js `>=20.17.0`
- Python `>=3.12`
- sibling or bundled `{trinity}` runtime

### Required for full local Apple-product behavior

- Full Disk Access for Apple Messages DB reads
- Calendar automation approval
- Mail.app configured if using Mail fallback behavior

### Required for specific channel/model features

- Ollama for local drafting/ranking models
- OpenClaw for WhatsApp transport

## Failure Concentration Points

### Message ingestion vs conversation visibility

Current product rule:

- dashboard source counts can be high even when contact enrichment is sparse
- sidebar visibility must come from valid message-backed handles, not from contact-row existence alone

This is now enforced in the conversation index path.

### Drafting runtime health

If `{trinity}` is unavailable:

- suggest endpoints degrade with operator-safe `503` responses
- sends and conversation browsing remain product-owned in `{reply}`

### Local substrate health

If Docker, Colima, sandbox, or OpenClaw substrate fails:

- the operator should see classified product-safe errors
- raw substrate details stay in logs

## Install Dependencies By Repo

### `{reply}`

- `npm install` in `chat/`
- Swift toolchain for `app/reply-app`

### `{trinity}`

- `uv sync --dev`

### `{train}`

- `uv sync --extra dev`

## Sync Rule

Update this document whenever one of these changes:

- runtime ownership between `{reply}`, `{trinity}`, and `{train}`
- local install prerequisites
- required external tools
- message/conversation assembly rules
- operator-visible failure classification
