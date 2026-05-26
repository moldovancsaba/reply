# Native Workspace Hot Path SSOT

## Purpose

This document is the canonical architecture contract for native workspace loading, preloading, caching, and incremental updates in `{reply}`.

It exists to prevent the product from drifting back into a request-coupled model where:

- one small user action reloads the whole workspace
- passive UI reads trigger broad reconstruction work
- profile saves, syncs, and thread refreshes compete with each other
- the native shell appears stalled because unrelated reads are chained behind a successful write

This is a performance document, but more importantly it is a product-architecture document.

## Non-Negotiable Rules

1. Passive workspace reads must come from prepared local state.
2. The visible conversation is a hot path and must have its own fast lane.
3. A successful write must not wait on a full workspace reload before the UI can recover.
4. New messages must update only the affected conversation/thread state by default.
5. Full rebuilds are allowed only for startup, repair, migration, or explicit resync paths.
6. Background preloading is allowed, but only for bounded likely-next data, not for entire-history eager loading.
7. The authoritative store remains SQLite-backed local data. In-memory caches are accelerators, not truth.

## Problem Statement

The current workspace still has traces of a broad reload model:

- profile save can wait on follow-up reads
- thread refresh can still pull unrelated state into the same action path
- passive reads can still experience timeout-like behavior when a route performs too much work
- native UI state can remain coupled to the completion of backend reloads instead of local optimistic patching plus background revalidation

This makes the app feel slower than the raw data layer requires.

## Target Runtime Shape

The workspace should operate through three layers.

### 1. Authoritative Local Store

Persistent truth lives in local SQLite stores:

- `chat.db`
- `contacts.db`
- canonical conversation foundation tables
- materialized read-model tables

This layer is durable and complete, but it is not the UI hot path by itself.

### 2. Materialized Read Models

Prepared browse-time state must live in local read models such as:

- `conversation_index`
- canonical thread/message tables
- profile/contact projections
- draft-context snapshots

These are owned by ingestion, sync, and background maintenance paths.

Passive routes must prefer these tables over live reconstruction.

### 3. Hot In-Memory Workspace Cache

The live hub may keep bounded in-memory state for the operator’s active workspace:

- current conversation page
- selected thread tail/head windows
- likely-next conversation summaries
- recent profile payloads
- last seen cursors / timestamps for delta fetches

This layer exists to improve latency. It must be disposable and rebuildable from the local read models.

## Required Product Behavior

### Conversation List

The sidebar must load from a prepared conversation index.

The native client may cache:

- the current page
- the next page
- a small lookahead set of likely-next rows

When a new message arrives:

- update the affected conversation row only
- move it in the ordering if needed
- update unread/preview/count metadata locally
- do not force a complete conversation list refresh

### Visible Thread

The visible thread must have a dedicated hot path.

Required behavior:

- preload a bounded recent window for the selected conversation
- optionally keep a small oldest-window / newest-window structure for long histories
- maintain a delta cursor such as `last_message_id`, `last_timestamp`, or equivalent canonical sequence marker
- append new inbound/outbound messages to the active thread incrementally
- backfill older history only when the operator scrolls or explicitly loads more

The visible thread should not be rebuilt from scratch after every new message or profile mutation.

### Adjacent / Likely Conversations

Background warming is allowed for likely-next conversations, but it must stay bounded.

Recommended warm set:

- selected conversation
- previous and next visible sidebar neighbors
- top N most recent conversations in the current page

Recommended preload depth:

- conversation summaries only for non-selected rows
- last 5-10 messages for likely-next rows only if cheap

Do not preload all messages for all conversations.

### Profile Reads and Writes

Profile save should follow this shape:

1. persist the contact/profile mutation
2. return success immediately from the write path
3. patch the selected profile state locally
4. schedule background revalidation
5. update any affected conversation row incrementally

Forbidden shape:

1. save profile
2. reload profile
3. reload conversations
4. reload thread
5. only then clear UI saving state

## Required Delta Model

The native shell should move toward delta-oriented refreshes.

### Minimal Delta Types

- `conversation_updated`
- `conversation_inserted`
- `conversation_removed`
- `messages_appended`
- `messages_updated`
- `profile_updated`
- `workspace_repaired`

These may initially be implemented as lightweight polling against version counters or timestamps before a true push/subscription model exists.

### Acceptable First Step

If a full event stream is too large for the first slice, implement:

- per-thread delta endpoint
- per-conversation summary versioning
- cheap local polling for the selected thread only

That still gets most of the product benefit.

Current implemented first step:

- `GET /api/thread` returns `deltaCursor` / `threadVersion`
- `GET /api/thread-delta` returns only rows newer than the current cursor
- successful send/profile actions patch local UI state first and schedule background revalidation separately

## Data Ownership Contract

### Background Worker / Hub Owns

- read-model maintenance
- hot cache invalidation
- likely-next preload queue
- per-thread delta cursor tracking
- bounded reconciliation after sync/send/save

### Native Client Owns

- current UI selection state
- local optimistic patching after successful saves/sends
- rendering cached rows/messages already received
- requesting explicit older-history backfill

### Native Client Must Not Own

- canonical message order reconstruction
- contact merge heuristics
- request-time aggregate recomputation
- broad workspace resync as a substitute for missing backend deltas

## Delivery Order

### Phase 1. Stop Global Reloads on Hot Actions

- decouple profile save from full workspace reload
- decouple thread refresh from conversation-list refresh
- return successful writes immediately after persistence

### Phase 2. Visible Thread Hot Cache

- add selected-thread tail cache
- add thread delta fetch/apply path
- append new messages incrementally

### Phase 3. Conversation Summary Delta Lane

- update one conversation row at a time on new message/profile events
- avoid broad sidebar rebuilds
- add likely-next conversation summary warming

### Phase 4. Instrumentation and Budgets

- measure route latency by action class
- define budgets for sidebar load, thread open, profile save, and delta apply
- surface degraded cache/rebuild conditions in health telemetry

## Performance Budgets

Initial target budgets for the local happy path:

- conversation page read: under 100 ms
- selected thread open from warm cache: under 150 ms
- profile save round trip: under 500 ms
- visible-thread delta apply after new message: under 100 ms

These are product targets, not hard realtime guarantees.

## Anti-Patterns

Do not reintroduce any of the following:

- request-time full workspace reconstruction for passive reads
- chaining save success to conversation-list rebuild completion
- broad `loadConversations()` after every minor mutation
- broad `loadProfile()` and `loadConversation()` reload fanout as default correctness strategy
- in-memory caches that become hidden truth and diverge from SQLite

## Canonical Implementation Rule

When there is tension between convenience and responsiveness, choose:

- SQLite-backed prepared read models for passive reads
- bounded in-memory caches for the visible workspace
- incremental delta application for active UI state

Do not choose whole-workspace refresh as the default consistency mechanism.
