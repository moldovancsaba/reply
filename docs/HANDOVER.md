# Handover

## Current State

- canonical repo root is `/Users/Shared/Projects/reply`
- documented package version is `0.5.14`
- live drafting runtime is `{trinity}`
- legacy drafting is no longer part of the normal live path
- structured draft outcomes use `/api/trinity/outcome`
- generic operator notes remain on `/api/feedback` and `/api/feedback/log`
- the sidebar conversation list now comes from the unified message-backed index instead of requiring a preexisting contact row
- canonical conversation-foundation tables now exist in `chat.db`
- contact merge and unmerge are manual-only, user-owned actions
- thread rendering now uses explicit left/right sent-versus-received rows
- initial thread load now preloads the oldest 20 and newest 20 messages and loads the middle gap progressively
- native sync triggers now send approval-bearing protected requests correctly

## Latest Documentation Sync

### 2026-05-07 Trinity Integration Follow-Through

Product/runtime seam tightened in the current working tree for the remaining `{reply}` side of the `{reply} <-> {trinity} <-> {train}` integration checklist.

Implemented changes:

- `company_id` is now normalized as a mandatory stable runtime identity everywhere `{reply}` constructs Trinity payloads.
- structured `DraftOutcomeEvent` emission now fails closed on missing required identity fields instead of sending partially formed payloads upstream.
- reply-side draft context now preserves bounded Trinity provenance cleanly:
  - `cycle_id`
  - `trace_ref`
  - `accepted_artifact_version`
- WhatsApp send paths now sanitize and preserve the same bounded Trinity draft context contract as the other channel send routes.
- the web draft-candidate surface now shows accepted artifact provenance plus trace reference in operator-visible runtime metadata.
- `{reply}` now exposes one bounded product-side Train proposal trigger on `/api/trinity/train-propose-policy`, which shells into `{trinity}` `train-propose-policy --adapter reply ...` without auto-accepting proposals by default.
- the shown-draft operator surface now exposes bounded Train proposal actions for:
  - `tone`
  - `brevity`
  - `channel-formatting`

Validation completed for this tranche:

- `node --test /Users/Shared/Projects/reply/chat/test/brain-runtime.test.js`
- `node --test /Users/Shared/Projects/reply/chat/test/conversation-foundation-store.test.js`
- `node --check /Users/Shared/Projects/reply/chat/brain-runtime.js`
- `node --check /Users/Shared/Projects/reply/chat/routes/messaging.js`
- `node --check /Users/Shared/Projects/reply/chat/js/api.js`
- `node --check /Users/Shared/Projects/reply/chat/js/app.js`
- `node --check /Users/Shared/Projects/reply/chat/server.js`

End-to-end product proof completed locally:

- started the local hub with `make run`
- fetched a real live conversation through `/api/conversations`
- generated a real Trinity draft cycle from `{reply}` product code for a live WhatsApp thread
- recorded a structured `SENT_AS_IS` outcome through `/api/trinity/outcome`
- triggered a bounded Train proposal through `/api/trinity/train-propose-policy` with:
  - `learnerKind=tone`
  - `cycleId=15c1f36c-f577-4976-bafa-d0d725a105fb`
  - `accept=false`
- verified the returned proposal and eval paths under the Trinity runtime root
- ran Trinity shadow fixtures with `PYTHONPATH=core uv run python -m trinity_core.cli run-shadow-fixtures --adapter reply`

Open note:

- the broad `npm test` suite showed a non-deterministic conversation-foundation failure once during a long run, but the affected suite passed on isolated rerun and the Trinity-integration-focused runtime tests passed after the current changes.

### 2026-05-07 Architecture-Lessons Codification

The repo docs now explicitly record the reusable lessons behind the current `{reply}` shape, not just the implementation details.

Added to repo docs:

- early normalization over late cleanup
- local materialized state as the passive UI source of truth
- identity separated from projection
- human review modeled as first-class lifecycle state
- decision separated from transport
- provenance treated as critical product data
- boundary erosion documented as the main long-term architecture risk

Primary docs updated:

- `/Users/Shared/Projects/reply/docs/LEARNINGS.md`
- `/Users/Shared/Projects/reply/docs/ARCHITECTURE.md`
- `/Users/Shared/Projects/reply/docs/DEPENDENCY_MAP.md`

### 2026-05-07 Connector Decision Memo

A dedicated connector decision memo now exists at:

- `/Users/Shared/Projects/reply/docs/CONNECTOR_DECISION_MEMO.md`

Use it before proposing new bridge or connector dependencies.

It captures:

- the difference between ingestion quality and send quality
- connector acceptance categories:
  - `product-acceptable`
  - `prototype-acceptable`
  - `research-only`
  - `do not use`
- current `{reply}` judgments on:
  - Barcelona
  - `mautrix-imessage`
  - `mautrix-whatsapp`
  - LinkedIn browser bridge patterns
  - MBSync-style local mirroring
  - vendor-unified inbox products such as Unipile

The practical intent is to stop connector work from drifting into “powerful demo dependency” decisions that would damage local truth or operator supportability.

### 2026-05-03

This documentation pass brings the repo docs up to date with the current runtime and product state.

Documented changes:

- native shell remains the intended operator shell for `{reply}`
- `{reply}` / `{trinity}` / `{train}` runtime split is now reflected in `README`, install docs, architecture docs, and dependency docs
- install docs now include:
  - Node.js requirement
  - Python 3.12+ requirement for `{trinity}`
  - sibling repo runtime resolution for `{trinity}`
  - Ollama and OpenClaw setup expectations
- docs now reflect the live drafting path:
  - `{reply}` builds `ThreadSnapshot`
  - `{trinity}` owns live drafting, ranking, and artifact application
  - `{train}` stays offline and bounded
- docs now reflect feedback semantics migration:
  - structured draft outcomes on `/api/trinity/outcome`
  - freeform logs on `/api/feedback*`
- docs now reflect operator-safe runtime error normalization
- docs now reflect the conversation visibility fix:
  - dashboard counts and sidebar visibility no longer diverge because of a tiny `contacts.db` whitelist

### 2026-05-03 Runtime Fix Included

Product fix shipped in the current working tree:

- `contact-store` now allows valid message-backed handles into the inbox even when there is no contact row yet
- conversation index routes now fall back to the actual handle when contact enrichment is absent
- frontend conversation cache version advanced to invalidate stale tiny cached pages
- thread API now supports deterministic oldest/newest ordering
- message UI now preloads both ends of the thread and fills long-history gaps incrementally
- WhatsApp sync now persists `is_from_me` for new unified message rows
- native sync actions in `reply.app` now attach approval headers and payloads, matching the hub’s protected-route contract

Validated on local data:

- prior visible conversations: `11`
- current visible conversations: `780`

## Validation

Validated during this sync:

- `node --test /Users/Shared/Projects/reply/chat/test/contact-store-inbox-eligibility.test.js /Users/Shared/Projects/reply/chat/test/conversation-data-source.test.js /Users/Shared/Projects/reply/chat/test/conversations-meta.test.js`
- `node --check /Users/Shared/Projects/reply/chat/js/contacts.js`
- `node --check /Users/Shared/Projects/reply/chat/contact-store.js`
- `node --check /Users/Shared/Projects/reply/chat/routes/messaging.js`

## Known Notes

- there are additional in-progress working-tree changes related to policy-loop and runtime-boundary work; they were documented rather than reverted
- `{trinity}` and `{train}` docs also required updates because the install and runtime story now spans all three repos
- the native app and the local hub are both valid operator entrypoints, but the product direction remains native-shell first

## Immediate Next Actions

1. keep `README.md`, `LOCAL_MACHINE_DEPLOYMENT.md`, `ARCHITECTURE.md`, and `DEPENDENCY_MAP.md` in sync whenever runtime prerequisites or boundaries change
2. treat conversation visibility as message-backed first and contact-enriched second in future indexing work
3. keep raw substrate errors out of normal operator UI surfaces
4. keep `{reply}` policy and transport authority separate from `{trinity}` learned behavior

## 2026-05-05 Native App Doc Handoff

- added a dedicated native app handoff document at `/Users/Shared/Projects/reply/docs/NATIVE_APP_BUILD_HANDOFF.md`
- the document is meant to be the first path shared with another agent when they need the exact build and install contract for `reply.app`
- it records:
  - canonical source files
  - bundle assembly behavior
  - install verification rules
  - launch verification behavior
  - reuse constraints for another project

### Validation

- `cd /Users/Shared/Projects/reply/app/reply-app && swift package dump-package >/dev/null`
- `cd /Users/Shared/Projects/reply/app/reply-app && bash -n ./build-bundle.sh`
- `cd /Users/Shared/Projects/reply/app/reply-app && bash -n ./install-bundle.sh`
- `cd /Users/Shared/Projects/reply/app/reply-app && plutil -lint ./Info.plist`
- `cd /Users/Shared/Projects/reply && bash -n ./script/build_and_run.sh`

## 2026-05-05 Foundation And Documentation Sync

- README, install docs, architecture docs, dependency map, contribution guide, and build handoff are now aligned on:
  - version `0.5.14`
  - manual-only merge authority
  - current conversation foundation schema presence
  - native shell install/build contract
- live `contacts.db` audit confirmed `0` active merged contacts after an idempotent purge check
