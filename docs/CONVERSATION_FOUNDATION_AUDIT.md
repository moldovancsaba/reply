# Conversation Foundation Audit

## Objective

Define a rock-solid long-range conversation foundation for `{reply}` that is:

- local-first
- timeline-rigid
- channel-explicit
- GDPR-friendly
- stable under merges, deletions, and future connector growth

This document is intentionally blunt. It describes the current flaws, the target model, and the delivery plan to eliminate them.

## Non-Negotiable Rules

1. `{reply}` owns its own UUIDs for contacts and conversations.
2. External channel IDs are references, never primary keys.
3. Conversation identity is immutable for a fixed participant membership set.
4. If membership changes, `{reply}` creates a new conversation snapshot.
5. One external thread may map to multiple `{reply}` conversation snapshots over time.
6. Passive UI reads prepared local state only.
7. Timeline order is canonical in the backend/database, never reconstructed ad hoc in the UI.
8. A channel may be used to reply only when `{reply}` has verified that channel identity for that conversation.
9. `{reply}` must not start a conversation on a channel the contact has never used inbound.
10. Contact merge and unmerge authority is fully manual and user-owned.
11. `{reply}` must not auto-merge two contacts, handles, or conversation identities through heuristics alone.

## Current Reality

### Conversation list

Current implementation:

- source: `conversation_index` in `chat.db`
- default order: `latest_timestamp_ms DESC`
- tie-break: `handle ASC`
- code: [chat/message-store.js](/Users/Shared/Projects/reply/chat/message-store.js), [chat/routes/messaging.js](/Users/Shared/Projects/reply/chat/routes/messaging.js)

The list is not backed by a canonical conversation entity. It is a materialized projection built from raw `unified_messages` grouped by handle and partially collapsed through contact lookup.

### Thread view

Current implementation:

- source: `unified_messages` in `chat.db`
- backend returns newest or oldest windows by raw message timestamp
- native app merges the oldest and newest windows and re-sorts locally for display
- code: [chat/routes/messaging.js](/Users/Shared/Projects/reply/chat/routes/messaging.js), [chat/message-store.js](/Users/Shared/Projects/reply/chat/message-store.js), [app/reply-app/Sources/ReplyCoreService.swift](/Users/Shared/Projects/reply/app/reply-app/Sources/ReplyCoreService.swift)

That means timeline authority is split between backend and UI.

### Contact and merge model

Current implementation:

- canonical contact rows live in `contacts.db`
- merges use `primary_contact_id`
- merges and unmerges are explicit user actions, not background inference
- thread expansion uses `getAllHandles()`
- verified channel proof lives in `contact_channels.inbound_verified_at`
- code: [chat/contact-store.js](/Users/Shared/Projects/reply/chat/contact-store.js), [chat/routes/contacts.js](/Users/Shared/Projects/reply/chat/routes/contacts.js), [chat/utils/outbound-policy.js](/Users/Shared/Projects/reply/chat/utils/outbound-policy.js)

Live local facts at audit time:

- contact rows: `92`
- merged contact rows: `0`
- contact channel rows: `111`
- inbound-verified channel rows: `83`

Manual-merge policy:

- user merges are allowed
- user unmerges are allowed
- no automatic phone/email/channel merge is allowed
- no fallback identity normalization may silently collapse two people into one canonical contact

### Live integrity mismatch

Live local `conversation_index` facts at audit time:

- total rows: `2068`
- `contact:*` canonical keys: `1601`
- `handle:*` canonical keys: `463`
- blank canonical keys: `4`
- `contact:*` keys missing from current `contacts.db`: `1596`

This means the current materialized conversation index is not reliably anchored to the current contact graph.

That is a foundation bug.

## Current Flaws

### F1. No canonical conversation entity

`{reply}` currently has:

- canonical messages
- contact rows
- a materialized sidebar projection

It does not have:

- a canonical stored conversation object with stable identity, fixed membership, lifecycle, and lineage

### F2. Handle-centric identity is not enough

Current grouping is mostly:

- raw handle
- optionally collapsed through contact lookup

That fails for:

- group chats
- multi-recipient email threads
- channel identity changes
- participant changes over time

### F3. Historical invalid-channel risk

This flaw was present during the audit pass and is now fixed in the shipped runtime.

Current shipped behavior:

- web and native composers only offer channels from `conversation_channel_capabilities`
- send requests carry `conversationId`
- routes reject stale conversation ids and channels not allowed for the active conversation snapshot

The remaining work is not UI gating. It is full canonical thread ownership and removal of the legacy compatibility fallback in `/api/thread`.

### F4. Channel-start rule is now first-class product truth

This is no longer only an environment-gated runtime check.

Current shipped behavior:

- `conversation_channel_capabilities` is stored in `chat.db`
- `/api/thread` exposes `allowedChannels`
- send routes enforce conversation capability state before transport-specific outbound policy checks

The product rule remains:

- if a conversation never used channel X inbound, `{reply}` cannot start or reply on channel X through that conversation snapshot

### F5. Multi-channel conversations are under-modeled

Today a conversation row carries one `channel`, usually derived from the latest row.

That hides:

- all other channels used in the same conversation
- per-message platform truth
- platform-specific send eligibility

### F6. Timeline order is not backend-final

The native app still merges and re-sorts message windows.

That must end.

The backend must own the canonical ordered timeline for each conversation snapshot.

### F7. Email and group semantics are not first-class

The current system is still fundamentally 1:1-handle-biased.

It is not a sufficient foundation for:

- group iMessage
- group WhatsApp
- email reply/reply-all with changing `To` and `Cc`

## Target Model

The correct model has two layers:

### 1. External thread lineage

Represents the external container or native thread family.

Table: `external_threads`

Core fields:

- `external_thread_id` UUID
- `channel`
- `provider_thread_key`
- `provider_thread_key_normalized`
- `thread_kind` = `direct` or `group`
- `first_seen_at`
- `last_seen_at`
- `metadata_json`

### 2. Conversation snapshot

Represents `{reply}`'s canonical immutable conversation block.

Membership is frozen for the snapshot.

Table: `conversation_snapshots`

Core fields:

- `conversation_id` UUID
- `external_thread_id` UUID nullable
- `parent_conversation_id` UUID nullable
- `superseded_by_conversation_id` UUID nullable
- `channel`
- `conversation_kind`
- `membership_fingerprint`
- `title`
- `opened_at`
- `closed_at`
- `closure_reason`
- `latest_message_at`
- `latest_inbound_at`
- `latest_outbound_at`
- `latest_message_id`
- `last_visible_summary`

### Participants

Table: `conversation_participants`

- `conversation_id`
- `participant_id`
- `contact_id` nullable
- `raw_address`
- `normalized_address`
- `channel_identity_kind`
- `is_self`
- `role`
- `joined_at`
- `left_at` nullable

### Canonical messages

Table: `conversation_messages`

- `message_id` UUID
- `conversation_id`
- `external_thread_id` nullable
- `provider_message_key`
- `provider_message_key_normalized`
- `channel`
- `source`
- `handle`
- `from_participant_id`
- `direction`
- `sent_at_utc`
- `received_at_utc` nullable
- `sort_timestamp_utc`
- `content_text`
- `content_summary`
- `has_attachments`
- `metadata_json`

### Per-message recipients

Table: `message_recipients`

- `message_id`
- `participant_id`
- `recipient_kind` = `to`, `cc`, `bcc`, `group_member`, `unknown`
- `raw_address`
- `normalized_address`

### Channel capability state

Table: `conversation_channel_capabilities`

- `conversation_id`
- `channel`
- `can_reply`
- `can_start`
- `has_inbound_proof`
- `last_inbound_at`
- `last_outbound_at`
- `last_inbound_identity`
- `capability_reason`

## Membership Rule

This audit adopts the strict foundation rule requested by the operator:

- if a participant is added, create a new conversation snapshot
- if a participant is removed, create a new conversation snapshot
- this remains true even if the external provider keeps the same native thread/group id

That means:

- one external thread may have many `{reply}` conversation snapshots
- snapshots are linked by lineage, not merged in place

## Email Rule

For the foundation pass, email follows the same strict snapshot logic.

If the governing participant set changes, `{reply}` opens a new conversation snapshot.

The governing participant set for email includes:

- sender
- `To`
- `Cc`

This is stricter than most mail clients. It is chosen deliberately for legal clarity, deletion control, and auditability.

## Required UI Truth

The UI contract must become:

- conversation list shows all channels present in the active conversation snapshot
- thread view shows the channel on every message
- thread view shows rigid timestamp per message
- thread view is newest-at-bottom, older-above, always
- composer only offers channels with `can_reply = true` or `can_start = true`
- channels that were never used inbound cannot be used to start

## Delivery Plan

### Phase 0. Audit lock

Deliver:

- this audit document
- current-state metrics
- backlog items

Acceptance:

- the current flaws are named once, clearly, and traceably

### Phase 1. Canonical schema insertion

Deliver:

- new canonical foundation tables in `chat.db`
- no UI cutover yet

Acceptance:

- schema exists
- indexes exist
- startup initializes them safely

### Phase 2. Capability truth and send gating

Deliver:

- conversation capability model
- required `can_start` / `can_reply` rules
- UI-ready capability payloads

Acceptance:

- invalid channel starts are impossible, not just discouraged

### Phase 3. Canonical conversation builder

Deliver:

- background builder that maps current canonical messages plus contacts into conversation snapshots
- participant fingerprinting
- snapshot supersession on membership changes

Acceptance:

- a conversation snapshot is a stored object, not a request-time reconstruction

### Phase 4. Canonical message timeline

Deliver:

- `conversation_messages`
- `message_recipients`
- strict backend ordering

Acceptance:

- `/api/thread` reads canonical timeline order only
- no native reordering logic remains

### Phase 5. Sidebar projection replacement

Deliver:

- replace `conversation_index` as the primary conversation foundation with a projection from canonical snapshot tables

Acceptance:

- sidebar is a thin projection of stored snapshots

### Phase 6. UI contract cleanup

Deliver:

- multi-channel badges in conversation list
- per-message platform badges
- channel-safe composer

Acceptance:

- operator can always see what happened on which platform

### Phase 7. Migration and integrity tooling

Deliver:

- rebuild command
- audit command
- orphan detection
- snapshot lineage inspection

Status:

- rebuild path exists through `rebuildConversationFoundation(...)`
- audit command exists as `npm run audit:conversations`

Acceptance:

- local repair is deterministic and replayable

## First Implementation Slice

This audit requires an immediate concrete start:

- insert canonical foundation tables into `chat.db`
- track the work in backlog and architecture
- keep current browse/send behavior unchanged until the canonical builder is ready

That first slice is intentionally narrow and safe.

It does not pretend to fix the foundation in one patch.

It establishes the database contract the rest of the migration will use.
