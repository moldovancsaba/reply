# Native Connector Recovery Plan

## Purpose

This document defines how `{reply}` should reimplement the lost product functions after the native SwiftUI workspace cutover.

The immediate goal is not “add more connectors.”

The immediate goal is:

1. restore native visibility for existing working channels and input sources
2. make sync and counts usable again from the native app
3. classify every platform correctly as:
   - conversation channel
   - draft-only bridge channel
   - input-only data source
   - not realistically solvable now

This is a native macOS recovery plan.

The target UI is SwiftUI/AppKit only for the operator workspace. Connectors and background runtimes may remain internal infrastructure, but the operator surface must stay native.

## Current Implementation Status

These parts are now reimplemented in the native workspace:

- source-specific dashboard cards with counts, sync state, and timestamps
- native per-source sync actions for supported connectors
- native dashboard grouping into `Conversation Sources`, `Knowledge Inputs`, and `Deferred Connectors`
- deeper native thread loading
- conversational left/right message alignment
- attachment and file markers rendered in the native thread
- richer iMessage ingestion through the local helper, including `attributedBody` decoding and attachment summaries

Outstanding thread work remains around explicit “load older” controls and further normalization of profile creation for handles that do not yet have stored contact records.

## Core Product Rule

Do not mix these classes together:

- **Conversation channels**
  - real thread list
  - real thread content
  - optional send path

- **Draft-only bridge channels**
  - inbound events may exist
  - drafting may exist
  - outbound is blocked or delegated

- **Input-only data sources**
  - enrich context, style, memory, and profiles
  - are not shown as conversations

## Current Reality

### Working local connectors with real sync routes now

- `iMessage`
- `WhatsApp`
- `Mail`
- `Apple Notes`
- `Apple Calendar`
- `Apple Contacts`
- `LinkedIn messages`
- `LinkedIn posts`
- `KYC / contact intelligence`

### Bridge-managed inbound draft-only channels now

- `Telegram`
- `Discord`
- `Signal`
- `Viber`
- `LinkedIn`

### Important classification correction

- `Apple Notes` is **not** a conversation channel.
- `Apple Calendar` is **not** a conversation channel.
- `Apple Contacts` is **not** a conversation channel.
- `LinkedIn posts` is **not** a conversation channel.

They belong in the native dashboard and intelligence surfaces, not in the conversation inbox.

## Platform Truth Table

This is the product truth table that should drive both implementation and copy.

### Native conversation channels now

- `iMessage`
  - Native dashboard card: yes
  - Native inbox/thread surface: yes
  - Native send path: yes

- `WhatsApp`
  - Native dashboard card: yes
  - Native inbox/thread surface: yes
  - Native send path: yes, where the local OpenClaw path is healthy

- `Mail`
  - Native dashboard card: yes
  - Native inbox/thread surface: yes
  - Native send path: yes
  - Important: mail remains a conversation-capable source, but it should not be presented with chat-like assumptions when the content is clearly message-thread mail

### Native knowledge inputs now

- `Apple Notes`
  - Native dashboard card: yes
  - Native inbox/thread surface: no
  - Native send path: no

- `Apple Calendar`
  - Native dashboard card: yes
  - Native inbox/thread surface: no
  - Native send path: no

- `Apple Contacts`
  - Native dashboard card: yes
  - Native inbox/thread surface: no
  - Native send path: no

- `LinkedIn posts`
  - Native dashboard card: yes
  - Native inbox/thread surface: no
  - Native send path: no

- `KYC / contact intelligence`
  - Native dashboard card: yes
  - Native inbox/thread surface: no
  - Native send path: no

### Native visibility only, but not first-class native connectors

- `LinkedIn messages`
  - Native dashboard card: yes, secondary/deferred section
  - Native inbox/thread surface: only when real synced or bridged content exists
  - Native send path: draft-only until there is a compliant outbound path

- `Telegram`
  - Native dashboard card: yes, deferred / bridge section only
  - Native inbox/thread surface: only if bridge events exist
  - Native send path: draft-only

- `Discord`
  - Native dashboard card: yes, deferred / bridge section only
  - Native inbox/thread surface: only if bridge events exist
  - Native send path: draft-only

- `Signal`
  - Native dashboard card: yes, deferred / bridge section only
  - Native inbox/thread surface: only if bridge events exist
  - Native send path: draft-only

- `Viber`
  - Native dashboard card: yes, deferred / bridge section only
  - Native inbox/thread surface: only if bridge events exist
  - Native send path: draft-only

## Native Dashboard Product Contract

The dashboard should become the operator control center for source health and sync, not just a generic health page.

### Card groups

1. `Conversations`
   - `iMessage`
   - `WhatsApp`
   - `Mail`

2. `Knowledge Inputs`
   - `Apple Notes`
   - `Apple Calendar`
   - `Apple Contacts`
   - `LinkedIn posts`
   - `KYC`

3. `Deferred / Bridge Channels`
   - `LinkedIn messages`
   - `Telegram`
   - `Discord`
   - `Signal`
   - `Viber`

### Per-card fields

Every native source card should show:

- local icon
- source title
- source class
- state pill
- ingested count
- last successful sync
- last attempted sync when relevant
- repair note when degraded
- native action row

### Per-card actions

- `Sync now`
- `Open settings` where meaningful
- `Open repair` only when blocked or degraded
- no fake actions for platforms that cannot really sync from this machine

## Native Recovery Objective

The native app must restore these lost operator capabilities:

1. dashboard cards with meaningful counts
2. per-source sync actions
3. clear distinction between conversation sources and input-only sources
4. bridge visibility for draft-only channels
5. usable runtime and connector status in one native control surface

## Platform Matrix

### Tier A — Must be native-first and fully visible now

These should become first-class native dashboard/status cards immediately:

- `iMessage`
- `WhatsApp`
- `Mail`
- `Apple Notes`
- `Apple Calendar`
- `Apple Contacts`
- `KYC`

For each card, the native app should show:

- source name
- current sync state
- count ingested / known
- last successful sync
- repair state if blocked
- native sync action
- native settings jump if applicable

### Tier B — Native visibility, but operationally secondary

These should appear as native secondary cards or a deferred connectors section:

- `LinkedIn messages`
- `LinkedIn posts`
- `Telegram`
- `Discord`
- `Signal`
- `Viber`

These are real product surfaces only if there is a real upstream ingestion path.

Without a real feeder, they must not pretend to be active.

### Tier C — Not realistically solvable now

These do not have a production-ready local-first path inside `{reply}` today and should be kept in the ideabank only until a compliant connector exists:

- `Facebook Messenger`
- `Instagram DMs`
- `WeChat`
- `Line`
- `Skype`
- `Snapchat`
- `official Viber direct local connector`
- `official Signal direct local connector`

Some of these may become possible later through compliant sidecars or official APIs, but they are not current product commitments.

## Native Dashboard Reimplementation Plan

## Phase 1 — Restore native dashboard cards

### Deliverable

A native SwiftUI dashboard section for:

- `iMessage`
- `WhatsApp`
- `Mail`
- `Apple Notes`
- `Apple Calendar`
- `Apple Contacts`
- `KYC`

### Required data

Reuse the existing health payload:

- `health.channels`
- `health.stats`
- `health.preflight`

### Native card fields

Per card:

- title
- source class
- state pill
- total count
- last sync timestamp
- error / blocked note if present
- action row

### Actions

- `Sync now`
- `Open settings` where meaningful
- `Open logs` only for repair contexts

### Issues

- `REPLY-NATIVE-001` Native dashboard source cards
- `REPLY-NATIVE-002` Native sync action row
- `REPLY-NATIVE-003` Native source count formatting and timestamp formatting

## Phase 2 — Separate conversation channels from input-only sources

### Deliverable

Native dashboard grouping:

- `Conversations`
- `Knowledge Inputs`
- `Deferred / Bridge Channels`

### Target grouping

#### Conversations

- `iMessage`
- `WhatsApp`
- `Mail`
- `LinkedIn messages` when real sync exists

#### Knowledge Inputs

- `Apple Notes`
- `Apple Calendar`
- `Apple Contacts`
- `LinkedIn posts`
- `KYC`

#### Deferred / Bridge

- `Telegram`
- `Discord`
- `Signal`
- `Viber`

### Issues

- `REPLY-NATIVE-004` Native source grouping model
- `REPLY-NATIVE-005` Remove false conversation semantics from non-conversation sources in the native UI

## Phase 3 — Bridge channel visibility

### Deliverable

Native bridge cards or list rows for:

- `Telegram`
- `Discord`
- `Signal`
- `Viber`
- `LinkedIn`

### Required behavior

If a bridge has no configured or recent inbound events:

- show `Not connected`
- do not pretend sync is available
- do not expose fake send controls

If a bridge is configured:

- show rollout mode
- show recent event counts
- show last inbound event
- show whether the channel is draft-only

### Issues

- `REPLY-NATIVE-006` Native bridge summary surface
- `REPLY-NATIVE-007` Native bridge health and last-event counts

## Phase 4 — Native conversation functionality parity

### Deliverable

Restore high-value operator parity for:

- real thread content
- profile pane visibility
- send path
- channel selection

### Recovery order

Do not try to recover every surface in parallel.

1. dashboard cards and sync actions
2. real conversation opening and thread rendering
3. composer/send parity
4. profile pane parity
5. bridge visibility

The first milestone is a native dashboard that tells the truth and lets the operator trigger sync safely.

## Implementation Constraints

- Do not reintroduce HTML/CSS/JavaScript as the main operator surface.
- Do not show input-only sources in the conversation list.
- Do not show draft-only bridge channels as if they have native send.
- Do not create cards for platforms with no real local connector or bridge path.
- Do not merge message counts and knowledge counts into one fake “messages” number.

## Exit Criteria

This plan is complete only when:

- the native dashboard shows correct cards and counts for all Tier A sources
- notes, calendar, contacts, and posts never appear as conversations
- bridge channels are visibly marked as deferred / draft-only
- unsupported platforms are kept out of the active product and live only in the ideabank
- the operator can understand source state and run sync from the native app without ambiguity
- startup selection

### Note

This is partly already back after the SwiftUI workspace cutover, but it still needs a disciplined parity pass.

### Issues

- `REPLY-NATIVE-008` Native conversation loading parity
- `REPLY-NATIVE-009` Native composer/send parity
- `REPLY-NATIVE-010` Native profile actions parity

## Phase 5 — Native settings and connector management parity

### Deliverable

Operator should be able to manage connector state without leaving the native app:

- Gmail / IMAP mail config
- worker quantities
- model config
- per-source repair actions
- bridge rollout visibility

### Issues

- `REPLY-NATIVE-011` Native connector settings parity
- `REPLY-NATIVE-012` Native repair guidance for blocked sources

## Platform-by-Platform Call

### iMessage

- Keep
- Native dashboard card: yes
- Native sync action: yes
- Native conversations: yes
- Native send: yes

### WhatsApp

- Keep
- Native dashboard card: yes
- Native sync action: yes
- Native conversations: yes
- Native send: yes

### Mail

- Keep
- Native dashboard card: yes
- Native sync action: yes
- Native conversations: yes
- Native send: yes

### Apple Notes

- Keep
- Native dashboard card: yes
- Native sync action: yes
- Native conversations: no
- Native send: no
- Product role: intelligence input only

### Apple Calendar

- Keep
- Native dashboard card: yes
- Native sync action: yes
- Native conversations: no
- Native send: no
- Product role: intelligence input only

### Apple Contacts

- Keep
- Native dashboard card: yes
- Native sync action: yes
- Native conversations: no
- Native send: no
- Product role: contact/profile source

### LinkedIn messages

- Keep, but secondary
- Native dashboard card: yes
- Native conversations: only if real message sync exists
- Native send: draft-only unless a compliant outbound path is restored cleanly

### LinkedIn posts

- Keep as input-only
- Native dashboard card: yes
- Native conversations: no
- Native send: no

### Telegram

- Bridge-only for now
- Native dashboard card: yes, but as deferred bridge
- Native conversations: only if bridge events are present
- Native send: no

### Discord

- Bridge-only for now
- Native dashboard card: yes, but as deferred bridge
- Native conversations: only if bridge events are present
- Native send: no

### Signal

- Bridge-only for now
- Native dashboard card: yes, but as deferred bridge
- Native conversations: only if bridge events are present
- Native send: no

### Viber

- Bridge-only for now
- Native dashboard card: yes, but as deferred bridge
- Native conversations: only if bridge events are present
- Native send: no

## Order of Implementation

1. native source cards for Tier A
2. native sync buttons for Tier A
3. native grouping by source class
4. bridge visibility for Tier B
5. remaining conversation/profile/send parity pass
6. native settings parity for connector management

## Definition of Done

This recovery lane is done only when:

- native dashboard cards exist for all Tier A sources
- notes/calendar/contacts are no longer treated as conversations anywhere in the native product
- bridge-only channels are visibly classified as bridge-only
- unsupported or unrealistic platforms are moved to the ideabank instead of implied as active product commitments
- the operator can understand counts, sync state, and repair state from the native app alone
