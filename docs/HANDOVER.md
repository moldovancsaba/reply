# Handover

## Current State

- canonical repo root is `/Users/Shared/Projects/reply`
- live drafting runtime is `{trinity}`
- legacy drafting is no longer part of the normal live path
- structured draft outcomes use `/api/trinity/outcome`
- generic operator notes remain on `/api/feedback` and `/api/feedback/log`
- the sidebar conversation list now comes from the unified message-backed index instead of requiring a preexisting contact row
- thread rendering now uses explicit left/right sent-versus-received rows
- initial thread load now preloads the oldest 20 and newest 20 messages and loads the middle gap progressively
- native sync triggers now send approval-bearing protected requests correctly

## Latest Documentation Sync

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
