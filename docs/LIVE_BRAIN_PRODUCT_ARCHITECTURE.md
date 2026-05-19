# Live Brain Product Architecture

## Purpose

This document is the current `{reply}` product-side contract for the live-brain system.

It separates:

- implemented product/runtime behavior
- target expansion that is not fully implemented yet

## Product Role

`{reply}` is the product shell.

`{reply}` owns:

- channel ingestion
- canonical message and contact persistence
- conversation and compose UI
- send execution
- explicit contact merge and unmerge authority
- normalized event emission into `{trinity}`

`{reply}` does not own:

- canonical long-term runtime memory
- runtime retrieval selection
- runtime draft ranking semantics
- offline policy learning

## Current Implemented Contract

The current live product/runtime seam is:

1. `{reply}` persists canonical messages, contacts, and documents locally.
2. `{reply}` emits bounded runtime events through one durable outbox.
3. `{reply}` requests live drafts from `{trinity}` through `/api/suggest`.
4. `{reply}` can request the latest runtime-owned prepared draft through `/api/trinity/prepared-draft`.
5. `{reply}` records structured outcomes through `/api/trinity/outcome`.
6. `{reply}` can emit bounded runtime telemetry through `/api/trinity/memory-event`.
7. `{reply}` can register documents with runtime memory through `/api/trinity/register-document`.

## Current Product Subsystems

### 1. Source ingestion

Owns:

- raw channel ingestion
- local mirroring into canonical stores
- document and knowledge-source ingestion
- stable source references

Primary outputs:

- canonical message rows
- contact rows
- document rows
- normalized runtime events

### 2. Product read models

Owns:

- conversation index
- canonical thread projections
- contact browse surfaces
- compose hydration state

These remain product-owned because they drive operator navigation and send affordances.

### 3. Trinity runtime bridge

Owns:

- `ThreadSnapshot` construction
- durable outbox delivery
- prepared-draft fetch
- outcome emission
- memory-event emission for bounded product telemetry
- document registration

This bridge is the only supported route between live product behavior and `{trinity}`.

### 4. Compose surface

Owns:

- input field
- draft presentation
- prepared-draft hydration
- manual edit tracking
- send gating
- operator-visible provenance

### 5. Ops and rollout controls

Owns:

- feature flags
- protected routes
- health and repair surfaces
- explicit Train proposal trigger surfaces where allowed

## Current Runtime Event Vocabulary

The current normalized event kinds are the snake-case runtime contract implemented in code:

- `inbound_message_recorded`
- `outbound_message_recorded`
- `contact_upserted`
- `document_registered`
- `document_deleted`
- `thread_viewed`
- `draft_shown`
- `draft_selected`
- `draft_edited`

These are emitted through the durable outbox in `chat/trinity-event-outbox.js` or through the bounded product-side `/api/trinity/memory-event` route when the event is UI-owned rather than store-owned.

Conceptual dot-style names such as `message.inbound.recorded` are useful for discussion, but they are not the current wire contract.

## Current Product APIs To `{trinity}`

The current product-side HTTP contract is:

- `POST /api/suggest`
- `POST /api/trinity/outcome`
- `POST /api/trinity/memory-event`
- `GET /api/trinity/prepared-draft`
- `POST /api/trinity/register-document`
- `POST /api/trinity/train-propose-policy`

Current notes:

- there is no `POST /api/trinity/suggest`; the normal live drafting route is still `POST /api/suggest`
- there is no product HTTP route named `POST /api/trinity/refresh-prepared-draft`
- prepared-draft refresh currently happens through the prepared-draft fetch path when the stored result is missing or stale, plus direct CLI/runtime refresh on the `{trinity}` side

## Current Local Persistence Responsibilities

`{reply}` remains the source of truth for:

- external channel identity
- canonical message history
- operator actions
- final sent text
- send success or failure
- explicit contact merge and unmerge decisions

`{reply}` also persists enough local state to stay usable without immediate runtime recomputation:

- canonical message store
- conversation index
- contact projections
- runtime event outbox
- latest draft provenance shown in product UI

The canonical `PreparedDraftSet` artifact remains runtime-owned by `{trinity}`.

## Current Compose Behavior

The implemented compose flow is:

1. operator opens a thread
2. `{reply}` loads local thread state immediately
3. `{reply}` asks `{trinity}` for the latest prepared draft through `GET /api/trinity/prepared-draft`
4. if a fresh prepared draft exists, compose hydrates from that runtime artifact directly
5. if it is missing or stale, `{reply}` force-refreshes the runtime path so `{trinity}` returns a fresh-or-best-available draft for the opened thread instead of falling back to product-owned local draft text
6. operator edits remain product-owned, but material draft changes now emit bounded `draft_edited` runtime telemetry
7. send or selection outcomes are emitted back to `{trinity}` through the structured outcome or memory-event path

## Comparison To Current Code

Implemented now in `{reply}`:

- durable Trinity event outbox
- system-wide store-owned message and contact event emission
- document registration and delete lifecycle participation
- prepared-draft fetch on thread open
- draft-shown, thread-viewed, and draft-selected runtime telemetry
- debounced composer `draft_edited` telemetry
- structured draft outcomes on `/api/trinity/outcome`

Still not fully implemented:

- richer product-side visibility for all prepared-draft freshness and provenance states
- broader explicit document update lifecycle semantics beyond current register/delete handling
- broader operator-edit semantics if the runtime needs more than the current bounded `draft_edited` signal

## Target Expansion

The target product architecture still includes work beyond the current slice:

- more complete prepared-draft freshness and repair UX
- broader active-thread refresh controls
- clearer advanced-mode runtime provenance surfaces
- broader system-wide lifecycle telemetry where product actions matter to runtime learning

Those are follow-on expansions. They should extend the current outbox and runtime bridge, not introduce a second product/runtime path.
