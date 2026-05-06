# Thin UI / Local Precompute Audit

## Rigid Product Rule

`{reply}` must behave as a thin local operator surface.

That means:

- the web UI and native UI should render precomputed local state
- passive browsing routes must read materialized local tables, not assemble context on demand
- heavy joins, vector scans, ranking, reconciliation, and summary building belong in local background workers
- the local AI/runtime layer may still do explicit drafting work when the operator asks for a draft, but passive workspace loading must not depend on live AI or LanceDB reconstruction
- periodic push to any online database happens after local preparation, never as a prerequisite for a fast UI

This is not a performance preference. It is an architecture rule.

## Allowed vs Forbidden

### Allowed

- reading `chat.db`, `contacts.db`, or another materialized local read model
- returning precomputed counts, previews, sort keys, and thread pages
- background ingestion updating local read models
- background workers enriching local read models with sync, annotation, or search metadata
- explicit operator-triggered drafting via `{trinity}` or another local AI runtime

### Forbidden

- passive conversation list routes that scan LanceDB or rebuild aggregate state on request
- passive thread routes that merge multiple stores live to reconstruct canonical history
- passive UI boot that blocks on context assembly, ranking, search, or remote dependency checks
- request-time fallback logic that hides missing precomputation by doing expensive live recovery
- web client logic that compensates for missing server-side read models with extra request fanout or local recomputation

## Current Audit Findings

### A. Conversation list is still partially assembled on request

Current path:

- [chat/routes/messaging.js](/Users/Shared/Projects/reply/chat/routes/messaging.js)

Current behavior:

- `/api/conversations` builds the list by combining:
  - `messageStore.getConversationIndexRows()`
  - `contactStore.refreshIfChanged()`
  - `vector-store.getUnifiedIndex()`
- sort modes like `freq` and `recommendation` compute request-time derived scores

Why this violates the rule:

- the route is not a thin read from a local materialized conversation index
- LanceDB-backed recovery is happening in the request path
- ranking and derived sort math are being recomputed for every load instead of being precomputed locally

Required end state:

- one materialized `conversation_index` read model in SQLite
- precomputed fields:
  - `handle`
  - `channel`
  - `source`
  - `display_name`
  - `preview`
  - `preview_timestamp`
  - `message_count`
  - `message_count_in`
  - `message_count_out`
  - `first_message_timestamp`
  - `latest_message_timestamp`
  - `sort_newest`
  - `sort_oldest`
  - `sort_freq`
  - `sort_volume_in`
  - `sort_volume_out`
  - `sort_volume_total`
  - `sort_recommendation`
- `/api/conversations` should only read and page that table

### B. Thread route browse path

Current path:

- [chat/routes/messaging.js](/Users/Shared/Projects/reply/chat/routes/messaging.js)

Current behavior:

- `/api/thread` reads:
  - `contactStore.getAllHandles()`
  - `messageStore.getMessagesForHandles()`

Current state:

- passive thread loading no longer depends on LanceDB history recovery
- passive thread loading no longer depends on request-time WhatsApp LID expansion
- canonical conversation rows are now the browse-time source of truth when present
- the route retries local conversation-foundation rebuild before using the temporary legacy compatibility fallback

Required end state:

- thread rendering reads only canonical conversation rows from SQLite
- all sources must populate canonical message rows during ingestion
- direction, handle aliasing, and channel normalization must be resolved before a route reads them
- contact/profile alias semantics should stay upstream of the route and not force cross-store reconstruction

### C. Suggest routes still assemble context live from multiple stores

Current paths:

- [chat/routes/suggestions.js](/Users/Shared/Projects/reply/chat/routes/suggestions.js)

Current behavior:

- `/api/suggest` and `/api/suggest-reply` fetch snippets and examples live from LanceDB
- `/api/suggest` may scan vector history to find the latest inbound context before falling back to SQLite

Why this only partially violates the rule:

- explicit drafting is allowed to invoke the local runtime
- but the input package should already exist as a local prepared artifact

Required end state:

- passive UI still stays thin
- explicit drafting reads a preassembled local `draft_context_snapshot` or equivalent prepared record
- background workers should maintain:
  - latest inbound message per handle
  - recent thread window
  - prepared knowledge snippet candidates
  - cached golden-example set or policy bundle reference

### D. Web client is still coupled to server-side reconstruction gaps

Current paths:

- [chat/js/messages.js](/Users/Shared/Projects/reply/chat/js/messages.js)
- [chat/js/contacts.js](/Users/Shared/Projects/reply/chat/js/contacts.js)

Current behavior:

- the client is reasonably thin already, but it still depends on endpoints whose response shape is built from request-time reconstruction
- gap loading is acceptable, but only if the API is serving materialized thread pages

Required end state:

- the client keeps pagination, cache, and rendering only
- no server endpoint used by passive browsing should need LanceDB fallback

## Architectural Direction

The correct model is:

1. ingestion writes canonical message rows
2. background workers maintain read models
3. UI routes read those models
4. explicit AI actions consume prepared local inputs
5. periodic export/push happens after local state is already usable

Put differently:

- local server computes
- local read models store
- UI reads

Not:

- UI request triggers reconstruction

## Required Read Models

### 1. `conversation_index`

Purpose:

- sidebar and dashboard conversation browsing

Update triggers:

- every inbound/outbound message write
- contact/profile changes
- alias/LID resolution changes

### 2. `thread_index` or canonical `unified_messages` completeness

Purpose:

- thread paging with no vector fallback

Requirement:

- every source must write canonical rows with:
  - `id`
  - `handle`
  - `path`
  - `source`
  - `timestamp`
  - `text`
  - `is_from_me`
  - normalized channel metadata

### 3. `handle_alias_index`

Purpose:

- pre-resolve:
  - WhatsApp phone <-> LID
  - contact aliases
  - cross-source handle equivalence

### 4. `draft_context_snapshot`

Purpose:

- explicit drafting only

Fields:

- latest inbound
- recent thread slice
- pre-ranked knowledge snippets
- policy/artifact version
- last prepared timestamp

## Staged Remediation Plan

### Phase 0: Rule Freeze

Deliver:

- document the thin-UI rule in standards and architecture docs
- classify every passive route as either:
  - compliant thin read
  - temporary compatibility read
  - forbidden live reconstruction

Acceptance:

- no ambiguity remains about what is allowed

### Phase 1: Read-Path Audit Table

Deliver:

- audit each UI-facing endpoint:
  - `/api/conversations`
  - `/api/thread`
  - `/api/health`
  - dashboard source summaries
  - profile side panel loaders
- record:
  - source tables read
  - request-time joins
  - vector/LanceDB usage
  - AI/runtime dependence
  - cache dependence

Acceptance:

- every passive route has a compliance label and removal target if non-compliant

### Phase 2: Materialized Conversation Index

Deliver:

- add SQLite-backed `conversation_index`
- move newest/oldest/freq/volume/recommendation sort keys into background-maintained columns
- remove request-time `getUnifiedIndex()` dependency from `/api/conversations`

Acceptance:

- `/api/conversations` reads one local table only
- no LanceDB call in the route

### Phase 3: Canonical Thread Completeness

Deliver:

- ensure every message source writes complete canonical thread rows
- remove request-time LanceDB history fallback from `/api/thread`
- remove request-time WhatsApp LID expansion from `/api/thread`

Acceptance:

- `/api/thread` reads canonical SQLite conversation rows without request-time vector reconciliation
- no request-time LID reconstruction
- no legacy `unified_messages` fallback remains after canonical rebuild retry

### Phase 4: Prepared Draft Context

Deliver:

- add a local prepared drafting snapshot store
- update suggest routes to consume prepared local context artifacts

Acceptance:

- explicit drafting is still allowed to call the local AI runtime
- but it no longer assembles browse-time state on the fly
- completed: `chat/prepared-context-store.js` now materializes `draft_context_snapshots`, suggest routes read those snapshots directly, and prepared golden examples are cached locally for reuse

### Phase 5: Worker Ownership

Deliver:

- move aggregate maintenance into background workers
- define refresh cadence and invalidation rules
- ensure online DB push is downstream of local readiness

Acceptance:

- local UX remains fast even if export/push is delayed
- completed for the current conversation/thread/dashboard/drafting path: canonical message writes maintain `conversation_index` and `draft_context_snapshots`, dashboard counts read the materialized index, and the background worker refreshes prepared drafting artifacts on a local cadence

## Immediate Code Targets

### Highest priority

1. remove request-time LanceDB merge from `/api/conversations`
2. remove request-time LanceDB history fallback and LID expansion from `/api/thread`
3. materialize sort keys instead of computing them in the route
4. precompute handle alias resolution

### Second priority

1. prepared draft context snapshots
2. dashboard summaries from materialized tables only
3. remove compatibility fallbacks after canonical rebuild retry is no longer needed

## Non-Negotiable Acceptance Criteria

- opening the workspace must not depend on vector scans
- opening a conversation must not depend on vector scans
- scrolling a thread must not trigger cross-store reconstruction
- sort changes must read precomputed sort keys
- the local server may prepare data in the background, but the UI reads only prepared state
- online export/push must never be required for a fast local UI

## Decision

From this point forward, any new passive route or UI surface that performs live reconstruction is a bug, even if it is fast on one machine.
