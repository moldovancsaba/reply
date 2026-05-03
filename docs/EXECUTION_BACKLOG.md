# {reply} Execution Backlog

## Objective

Deliver the `{reply}` portion of the cross-project boundary program without mixing repository ownership.

`{reply}` remains the product shell. It owns channels, operator workflow, local app integration, and outbound execution. It must stop growing a parallel canonical brain.

## Milestones

### M1. Boundary Insertion

- [x] Add a brain-runtime adapter so product callers stop importing the legacy reply engine directly.
- [x] Fix suggestion result normalization so API handlers do not persist structured objects as draft text.
- [x] Fix `channel-bridge.js` lint/runtime break caused by the missing data-home directory symbol.
- [x] Record the execution backlog and issue queue in-repo.

### M2. Trinity Alignment

- [x] Map channel and conversation evidence into the Trinity reply contract.
- [x] Add shadow-mode comparison between legacy drafting and `{trinity}` candidate outputs.
- [x] Route one bounded operator workflow through the `{trinity}` adapter boundary.

### M3. Legacy Retirement

- [x] Remove direct brain ownership from legacy runtime paths after `{trinity}` cutover succeeds.
- [x] Move feedback semantics onto the `{trinity}`-owned contract once feedback memory is available upstream.

## Active Issue Queue

### Closed

- `REPLY-001` Missing brain-runtime adapter
  Product routes and workers imported `reply-engine.js` directly, which made the legacy engine the de facto canonical brain. Fixed by inserting `chat/brain-runtime.js` as the caller-facing boundary.

- `REPLY-002` Broken suggestion normalization in `/api/suggest-reply`
  The route could persist a structured reply result instead of the actual suggestion text. Fixed by normalizing all reply results before saving or returning them.

- `REPLY-003` `channel-bridge.js` referenced an undefined data directory symbol
  This broke linting and risked audit-log persistence failures. Fixed by using `ensureDataHome()` instead of the missing symbol.

- `REPLY-004` Critical dependency audit under local intelligence stack
  `@xenova/transformers` resolved vulnerable ONNX and protobuf transitives. Fixed by updating `imapflow` and adding safe dependency overrides for `onnxruntime-web` and `protobufjs`, followed by a clean audit pass.

- `REPLY-POLICY-001` Export contract hardening
  `{reply}` already emitted the right runtime concepts, but the product-side payload builders did not consistently stamp the canonical contract version or normalize outbound outcome payloads in one place. Fixed by hardening `chat/brain-runtime.js` so `ThreadSnapshot` includes `contract_version`, `DraftOutcomeEvent` payloads are normalized before crossing into `{trinity}`, and reply-side draft context preserves cycle trace and accepted artifact provenance from the ranked draft set.

- `REPLY-POLICY-002` Active policy provenance emission
  `{reply}` already received accepted artifact provenance from `{trinity}` inside ranked draft sets, but it did not surface that provenance consistently through the product-facing metadata path. Fixed by propagating `accepted_artifact_version` through `chat/brain-runtime.js` context metadata and shadow-comparison records, while preserving it in reply-side draft context for downstream send and feedback flows.

- `REPLY-POLICY-003` Product gate separation
  Learned behavior artifacts must not be able to smuggle transport, approval, or bridge semantics back through the product shell. Fixed by adding strict draft-context sanitization in `chat/brain-runtime.js`, applying it before channel send handlers in `chat/routes/messaging.js`, and ensuring send outcome reporting uses only bounded runtime facts while outbound gating, transport selection, and human-approval policy remain owned by `{reply}`.

- `REPLY-POLICY-004` Training-bundle handoff shape
  `{reply}` needed an explicit bounded export surface for operator/runtime facts instead of passing arbitrary draft context back upstream. Fixed by adding a single outcome-fact builder in `chat/brain-runtime.js`, using it from send-finalization paths in `chat/routes/messaging.js`, and covering that only deterministic cycle/thread/candidate/final-text/send-result/timing facts cross into `{trinity}` for later bundle export.

- `REPLY-005` `{trinity}` shadow-mode execution
  The adapter boundary existed, but the repo still needed a proven developer-only shadow lane that dual-runs `{trinity}` while keeping legacy output active for comparison. Fixed by exercising `trinity-shadow` mode in `chat/brain-runtime.js`, persisting deterministic comparison artifacts, exposing them through the existing shadow-comparison API, and covering the end-to-end shadow execution path in tests.

- `REPLY-007` Legacy brain retirement on live runtime paths
  `{reply}` still retained `reply-engine.js` as a live fallback brain outside shadow comparison. Fixed by making `{trinity}` the only active drafting runtime in `chat/brain-runtime.js`, keeping legacy generation only for developer shadow comparison, and removing the client-side Trinity outcome flow from the generic feedback route.

- `REPLY-008` Explicit Trinity outcome API surface
  Trinity draft outcomes were still being tunneled through `/api/feedback` alongside unrelated freeform logs. Fixed by adding `/api/trinity/outcome` in `chat/server.js`, handling it with a dedicated route in `chat/routes/messaging.js`, and updating `chat/js/api.js` so product-side draft outcomes use the explicit contract path while `/api/feedback` remains for generic logs only.

- `REPLY-009` Feedback-semantics migration onto Trinity-owned contracts
  `{reply}` still mixed structured draft feedback with generic note logging at the endpoint layer. Fixed by keeping Trinity outcomes on `/api/trinity/outcome`, reserving `/api/feedback` and `/api/feedback/log` for unstructured operator notes only, and updating the draft-replacement client path to use the generic note route rather than the structured outcome contract.

### Open

- `REPLY-006` Dev-toolchain major-version upgrade lane
  `chat` is clean on tests, lint, audit, and the native package rebuild after safe dependency updates, but major upgrades remain for the ESLint toolchain. Those should be handled in a dedicated compatibility pass rather than mixed into runtime-boundary work.

- `REPLY-NATIVE-001` Native dashboard source cards
  Completed. The native dashboard now renders source-specific cards for `iMessage`, `WhatsApp`, `Mail`, `Apple Notes`, `Apple Calendar`, `Apple Contacts`, `KYC`, and deferred sources, with visible counts, sync state, and timestamps.

- `REPLY-NATIVE-002` Native sync action row
  Completed. Native per-source sync actions are restored on the dashboard cards so the operator can refresh supported connectors without leaving the app.

- `REPLY-NATIVE-003` Native source count and timestamp formatting
  Completed. Native source cards now use one count/timestamp presentation pattern for state, last successful sync, and last attempted sync.

- `REPLY-NATIVE-004` Native source grouping model
  Completed. The native dashboard now groups sources into `Conversation Sources`, `Knowledge Inputs`, and `Deferred Connectors`.

- `REPLY-NATIVE-005` Remove false conversation semantics from non-conversation sources in the native UI
  Enforce the product rule that `Apple Notes`, `Apple Calendar`, `Apple Contacts`, and `LinkedIn posts` are inputs, not conversations.

- `REPLY-NATIVE-006` Native bridge summary surface
  Add native visibility for `Telegram`, `Discord`, `Signal`, `Viber`, and `LinkedIn` bridge status without pretending they are fully native connectors.

- `REPLY-NATIVE-007` Native bridge health and last-event counts
  Surface rollout mode, recent event counts, and last inbound timestamps for bridge-managed channels.

- `REPLY-NATIVE-008` Native conversation loading parity
  Partially completed. The thread now loads significantly deeper history, renders conversational left/right alignment, preloads the oldest 20 and newest 20 messages, preserves attachment/file markers, and fills long-history gaps incrementally in the background. Further native-specific thread affordances may still be added later, but the underlying parity gap is much smaller now.

- `REPLY-NATIVE-016` Native sync trigger contract mismatch
  Fixed in the current working tree. The native shell had been calling protected `/api/sync-*` routes without the approval-bearing request shape used by the web app, causing broad trigger failures across multiple sources. The native client now sends JSON approval payloads plus the human-approval header so the trigger path can start background sync correctly.

- `REPLY-NATIVE-009` Native composer/send parity
  Restore reliable channel-aware send behavior and native draft/composer ergonomics.

- `REPLY-NATIVE-010` Native profile actions parity
  Reintroduce archive/remove/block/hidden-contact management cleanly in the native profile pane.

- `REPLY-NATIVE-011` Native connector settings parity
  Expose connector management and repair settings in the native app instead of relying on the older rendered settings behavior.

- `REPLY-NATIVE-012` Native repair guidance for blocked sources
  Add explicit native recovery flows for blocked `iMessage`, disconnected mail, WhatsApp/OpenClaw failures, and other degraded connectors.

- `REPLY-NATIVE-013` Native platform truth table enforcement
  Encode the product classification rules directly into the native dashboard and inbox so `Conversations`, `Knowledge Inputs`, and `Deferred / Bridge Channels` cannot visually collapse back into one ambiguous source list.

- `REPLY-NATIVE-014` Native counts contract for connector cards
  Define exactly which count each card shows (`messages`, `documents`, `contacts`, `events`, or `profiles`) so the operator is not shown misleading cross-source numbers.

- `REPLY-NATIVE-015` Native bridge honesty lane
  Ensure `Telegram`, `Discord`, `Signal`, `Viber`, and `LinkedIn` are labeled truthfully as bridge-fed or draft-only where applicable, without fake sync/send promises.

## Dependencies

- Depends on `{trinity}` for canonical runtime vocabulary and future candidate/frontier execution.
- Feeds `{train}` only through offline fixtures and bounded evaluation artifacts, never by handing over product orchestration.
