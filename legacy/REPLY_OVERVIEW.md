# {reply} Overview

## What `{reply}` is

`{reply}` is a macOS-first local communication operating system for a single human operator.

It brings inbound communication, profile context, local knowledge, draft generation, and outbound execution into one local product.

The core job of `{reply}` is:

1. ingest communication and context from multiple local/personal sources
2. organize that around contacts and conversations
3. generate or refine replies locally
4. help the operator decide what to do next
5. execute the final action through the correct channel
6. capture feedback and outcomes for future improvement

`{reply}` is the operator-facing product.

It is not the long-term workflow brain runtime itself, and it is not the offline optimization platform. Those roles belong to `{trinity}` and `{train}` respectively.

## Product purpose

`{reply}` exists to reduce the friction of handling fragmented personal and professional communication across channels.

Instead of checking separate apps, separate message histories, and separate drafting contexts, the operator works from one local system that:

- sees the conversation history
- sees the contact context
- can retrieve relevant knowledge
- can draft replies locally
- can execute sends through the right transport
- keeps the human in final control

## What `{reply}` does today

### 1. Aggregates communication into one local workspace

`{reply}` can ingest and unify:

- iMessage
- WhatsApp
- email
- Apple Notes
- Apple Calendar
- Apple Contacts
- LinkedIn messages
- LinkedIn posts

The workspace is contact-centric. A person can have multiple handles, aliases, or channels, and `{reply}` tries to unify them into one operator view.

### 2. Maintains a conversation and contact system

`{reply}` stores and serves:

- conversation lists
- message threads
- contact profiles
- merged aliases
- notes
- connected services
- KYC-style operator metadata
- channel verification state

This gives the operator a profile pane and a conversation pane instead of raw app-specific silos.

### 3. Builds local context for reply generation

`{reply}` assembles context from:

- recent thread history
- recipient-scoped history across channels
- retrieved local snippets
- notes and profile fields
- annotated knowledge
- golden examples
- relationship and tone hints

That context is used for suggestions, refinement, and future next-best-action work.

### 4. Generates and refines drafts locally

`{reply}` uses local Ollama-backed inference to:

- suggest a draft
- refine an existing draft
- create background drafts for active conversations
- attach local context and knowledge to the drafting pipeline

Drafting is local-first and designed for human review rather than autonomous send.

### 5. Executes outbound actions

`{reply}` can send or hand off outbound actions through:

- iMessage
- WhatsApp
- email
- LinkedIn

The send path depends on the channel and uses local platform-specific execution paths.

### 6. Captures feedback and operational state

`{reply}` records:

- accepted drafts
- replaced drafts
- edited drafts
- send outcomes
- contact-level notes and suggestions
- triage actions

This is the basis for future learning and optimization.

## Major capabilities

### Channel ingestion

- iMessage sync from Apple Messages database
- WhatsApp sync through OpenClaw
- Gmail / IMAP / Mail.app email sync
- Apple Notes sync
- Apple Calendar sync
- Apple Contacts sync
- LinkedIn import paths

### Operator workspace

- dashboard
- conversation list
- thread view
- profile pane
- settings page
- native macOS shell

### AI assistance

- suggest draft
- refine draft
- background draft generation
- annotated knowledge retrieval
- contextual reply generation

### Contact intelligence

- KYC-style contact metadata
- alias merge / unlink
- notes
- suggestions
- connected services
- local intelligence snippets

### Triage and prioritization

- rule-based triage
- priority queue
- suggested actions
- triage logs

### Health and control

- runtime health
- worker health
- source sync status
- service control
- native app-owned runtime management

## How `{reply}` works

## Runtime model

`{reply}` runs locally as:

- a hub process
- a background worker
- a native macOS shell

The hub serves the product UI and API.

The background worker handles ingestion, polling, drafting, annotation, and periodic intelligence work.

The native shell launches as `reply.app`, supervises the local runtime, and provides native runtime and settings surfaces.

## Storage model

`{reply}` uses local-first storage:

- SQLite-backed local stores for contacts, messages, and runtime state
- LanceDB for local semantic retrieval and annotation-backed memory
- local JSON/settings state where appropriate
- app-owned mutable data in `~/Library/Application Support/reply`
- logs in `~/Library/Logs/reply`

## Interaction model

The normal product loop is:

1. sync data from channels and local sources
2. build contact and conversation views
3. let the operator open a conversation
4. assemble context for that contact
5. generate or refine a draft
6. let the operator edit, approve, or reject
7. send through the chosen channel
8. record the outcome and feedback

## Current architecture shape

Today `{reply}` has:

- a native macOS product shell
- a local hub/runtime
- a background worker
- app-owned local storage and logs
- a still-transitional embedded workspace UI

That means:

- product identity: native macOS app
- runtime ownership: local/native-first
- primary workspace implementation: still partly browser-era inside the native shell

This is an important current truth.

`{reply}` is already a macOS product, but the main operator interface is not yet fully native SwiftUI/AppKit end to end.

## What `{reply}` is capable of operationally

`{reply}` can currently act as:

- a unified inbox/workspace
- a local reply drafting assistant
- a multi-channel send console
- a contact intelligence console
- a local triage assistant
- a runtime-supervised macOS communication tool

## What `{reply}` is not

`{reply}` is not:

- a cloud-first SaaS core
- a fully autonomous communication agent
- a generic CRM
- a team collaboration suite
- the offline optimization engine
- the future standalone workflow brain runtime

## Relationship to `{trinity}` and `{train}`

The intended split is:

- `{reply}` = the product the operator uses
- `{trinity}` = the workflow runtime that should eventually own staged candidate generation / evaluation / selection
- `{train}` = the bounded optimizer that improves parts of `{trinity}` and `{reply}` offline

So:

- `{reply}` should own the operator experience, data adapters, send actions, and feedback capture
- `{trinity}` should own the runtime workflow brain
- `{train}` should own bounded optimization and ratcheted improvement

## Current constraints and realities

`{reply}` is macOS-first because several integrations depend on local Apple or desktop capabilities:

- Messages database access
- AppleScript / automation surfaces
- Mail.app fallback
- Calendar access
- Notes access
- local device routing and helper behavior

Some integrations require machine-level permissions or external local dependencies, including:

- Full Disk Access for protected Apple data access
- Calendar / automation consent
- Ollama for local AI drafting
- OpenClaw for WhatsApp routing

## One-line definition

`{reply}` is a local macOS communication hub that unifies channels, builds contact-aware context, drafts replies locally, and lets a human operator execute the final action.
