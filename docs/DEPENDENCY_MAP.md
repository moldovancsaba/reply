# {reply} Dependency Map

**Doc freshness:** 2026-05-20  
**Purpose:** current runtime and install dependency map for `{reply}` after the Trinity runtime cutover, native-shell rollout, thin-read work, and conversation-foundation insertion.

This document is no longer a historical issue graph. It is the current dependency map for:

- local runtime prerequisites
- cross-repo dependencies
- product-layer boundaries
- operator-critical failure points

See also:

- [RELATION_AUDIT.md](/Users/Shared/Projects/reply/docs/RELATION_AUDIT.md) for the bidirectional app/service inventory and the latest local health audit snapshot

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
- canonical conversation-foundation tables
- contact enrichment
- local settings
- semantic retrieval
- bridge pending-write outbox reconciliation

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

- `suggest --adapter reply`
- `record-outcome --adapter reply`
- `export-trace --adapter reply`
- `export-training-bundle --adapter reply`
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

## Bidirectional Relation Inventory

This document tracks architectural dependency classes. The concrete relation list now lives in:

- [RELATION_AUDIT.md](/Users/Shared/Projects/reply/docs/RELATION_AUDIT.md)

That document records:

- what `{reply}` requires or references
- what requires or references `{reply}`
- which channels are first-class versus vocabulary-only
- the latest observed local health snapshot

## Failure Concentration Points

### Message ingestion vs conversation visibility

Current product rule:

- dashboard source counts can be high even when contact enrichment is sparse
- sidebar visibility must come from valid message-backed handles, not from contact-row existence alone

This is now enforced in the conversation index path.

### Normalization timing

Current product rule:

- channel-specific message shapes should be normalized near ingestion
- downstream thread assembly, drafting snapshots, and outcome recording should consume the normalized form

Reason:

- late normalization increases drift across browse, send, and learning paths

### Merge authority

Current product rule:

- contact merge and unmerge is explicit user-owned state
- no background worker, route, or projection layer may auto-merge two identities through phone normalization, email similarity, or channel overlap

This is a trust and GDPR boundary, not a convenience feature.

### Identity vs projection authority

Current product rule:

- contact identity is not the same thing as conversation membership
- conversation projection may link contacts, notes, and draft context, but it must not silently redefine identity

Reason:

- the workspace needs durable thread truth without turning every related artifact into an implicit merged person

### Drafting runtime health

If `{trinity}` is unavailable:

- suggest endpoints degrade with operator-safe `503` responses or bounded local fallback, depending on the runtime path
- sends and conversation browsing remain product-owned in `{reply}`

### Bridge write durability

Current product rule:

- inbound bridge normalization should not block indefinitely on `chat.db`
- bridge writes may spool into `channel_bridge_pending.json` when SQLite is busy
- the background worker owns queued bridge replay under a dedicated lock
- replay must reconcile against already-persisted `unified_messages` rows before retrying

### Review and provenance health

If provenance or outcome semantics drift:

- the learning loop becomes untrustworthy before the UI becomes obviously broken
- `cycle_id`, `trace_ref`, `accepted_artifact_version`, and deterministic outcomes must be treated as critical runtime data, not optional metadata

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
- merge/unmerge authority rules
- operator-visible failure classification
