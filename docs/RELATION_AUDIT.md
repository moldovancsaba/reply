# `{reply}` Relation Audit

**Doc freshness:** 2026-05-20  
**Purpose:** authoritative inventory of the apps, runtimes, services, and companion surfaces that `{reply}` depends on or references, plus the inverse surfaces that depend on or reference `{reply}`.

This document has two jobs:

- keep the relation map explicit in both directions
- record the latest local health audit snapshot with evidence

## Direction 1: `{reply}` Requires Or References These Systems

### Core platform and runtime

| Relation | Type | Criticality | Why `{reply}` needs it | Main evidence |
| --- | --- | --- | --- | --- |
| macOS 15+ | platform | required | native shell, Apple-private data access, desktop automations | `README.md`, `docs/DEPENDENCY_MAP.md`, `app/reply-app/Package.swift` |
| Node.js `>=20.17.0` | runtime | required | hub, routes, worker, local API | `chat/package.json`, `docs/DEPENDENCY_MAP.md` |
| Swift 6 / Xcode | toolchain | required for native app and helper | `reply.app` and `reply-helper` build/install path | `app/reply-app/Package.swift`, `docs/LOCAL_MACHINE_DEPLOYMENT.md` |
| Python `>=3.12` | runtime | required | `{trinity}` CLI execution | `docs/DEPENDENCY_MAP.md`, `README.md`, `chat/brain-runtime.js` |
| SQLite | storage | required | `chat.db`, `contacts.db`, Apple source reads | `docs/DEPENDENCY_MAP.md`, `chat/sync-imessage.js`, `chat/sync-whatsapp.js`, `chat/sync-mail.js` |
| LanceDB | storage/search | required | vector store, retrieval, annotations | `chat/package.json`, `docs/DEPENDENCY_MAP.md` |

### Cross-repo and model runtimes

| Relation | Type | Criticality | Why `{reply}` needs it | Main evidence |
| --- | --- | --- | --- | --- |
| `{trinity}` | repo/runtime | required | live drafting, outcome recording, trace export, training bundle export | `chat/brain-runtime.js`, `docs/ARCHITECTURE.md` |
| `{train}` | repo/runtime | optional at operator runtime, required for bounded learning loop | consumes exported bundles and proposes policies | `README.md`, `docs/DEPENDENCY_MAP.md` |
| Ollama | local model runtime | optional but operationally important | local drafting/refinement and model-backed runtime roles | `chat/gemini-client.js`, `chat/routes/settings.js`, `README.md` |

### Channel and source integrations

| Relation | Type | Criticality | Why `{reply}` needs it | Main evidence |
| --- | --- | --- | --- | --- |
| Apple Messages / iMessage | source + send path | important | sync inbound history and send iMessages | `chat/sync-imessage.js`, `chat/routes/messaging.js` |
| WhatsApp Desktop local DB | source | important | sync local WhatsApp history | `chat/sync-whatsapp.js` |
| OpenClaw | transport/gateway | important | WhatsApp outbound and gateway health | `chat/openclaw-gateway-env.js`, `chat/openclaw-guard.js`, `chat/routes/messaging.js` |
| Gmail API / Google OAuth | source + send path | optional but first-class | Gmail sync and outbound send | `chat/gmail-connector.js`, `chat/routes/settings.js` |
| IMAP server | source | optional | alternate email sync path | `chat/sync-imap.js` |
| Mail.app | fallback source + send handoff | optional but important | Apple Mail fallback ingestion and compose fallback send | `chat/sync-mail.js`, `chat/routes/messaging.js` |
| Apple Calendar | source | optional but first-class | calendar event indexing | `chat/sync-calendar.js` |
| Apple Contacts | source | optional but first-class | contact/profile enrichment | `chat/ingest-contacts.js`, `app/reply-app/Info.plist` |
| Apple Notes | source | optional but first-class | note ingestion for context | `chat/sync-notes.js` |
| LinkedIn | source + outbound handoff | optional but first-class | message ingest, post ingest, contact import, clipboard send handoff | `chat/sync-linkedin.js`, `chat/linkedin-sidecar.js`, `chat/routes/messaging.js` |
| Playwright / Chromium | browser automation runtime | optional but currently required for LinkedIn sidecar path | LinkedIn sidecar browser automation | `chat/linkedin-sidecar.js`, `chat/package.json` |

### Internal operating surfaces

| Relation | Type | Criticality | Why `{reply}` needs it | Main evidence |
| --- | --- | --- | --- | --- |
| `reply.app` | native shell | primary operator surface | runs workspace and controls bundled runtime | `app/reply-app/Sources/ReplyApp.swift`, `ReplyCoreService.swift` |
| `reply-helper` | native helper | important | protected Apple data export/mirroring | `app/reply-app/Sources/ReplyHelper/main.swift` |
| `launchd` / `com.reply.hub` | service manager | optional | repo-supported background launch mode | `tools/launchd/com.reply.hub.plist`, `tools/scripts/reply_service.sh` |

## Direction 2: These Systems Require Or Reference `{reply}`

| Relation | Type | How it depends on `{reply}` | Main evidence |
| --- | --- | --- | --- |
| `reply.app` | native client | polls `{reply}` health, launches/stops runtime, uses hub APIs | `app/reply-app/Sources/ReplyCoreService.swift` |
| `reply-helper` | helper | ships only to serve `{reply}` protected-data access patterns | `app/reply-app/Sources/ReplyHelper/main.swift` |
| ReplyMenubar | local companion app | repo-managed macOS menubar utility tied to `{reply}` workflows | `tools/macos/ReplyMenubar/MenubarCore.swift`, `AGENTS.md` |
| Chrome LinkedIn bridge extension | browser companion | posts LinkedIn events into `{reply}` local hub | `chat/chrome-extension/manifest.json`, `chat/chrome-extension/content.js` |
| LinkedIn userscript bridge | browser companion | posts LinkedIn events into `{reply}` local hub | `chat/js/linkedin-bridge.user.js` |
| LinkedIn sidecar | browser automation companion | sends scraped LinkedIn events to `{reply}` bridge endpoint | `chat/linkedin-sidecar.js` |
| `com.reply.hub` LaunchAgent | operating surface | exists only to keep `{reply}` hub online | `tools/launchd/com.reply.hub.plist` |
| runbook scripts | operating surface | start, stop, inspect, and repair `{reply}` | `runbook/start.sh`, `runbook/status.sh`, `runbook/doctor.sh`, `runbook/stop.sh` |
| `{trinity}` adapter contract | cross-repo | uses `reply` adapter shape and `{reply}` runtime payloads | `chat/brain-runtime.js` |
| `{train}` export path | cross-repo | consumes bundles emitted from live `{reply}`-initiated runtime flows | `README.md`, `docs/ARCHITECTURE.md` |

## Referenced But Not Yet First-Class

These channels exist in bridge normalization or UI vocabulary, but the repo does not currently show the same depth of productized sync/send support as iMessage, WhatsApp, mail, and LinkedIn:

- Telegram
- Discord
- Messenger
- Instagram
- Signal
- Viber
- SMS

Primary evidence: `chat/channel-bridge.js`.

## Local Health Audit Snapshot

**Audit date:** 2026-05-20  
**Machine context:** local repo at `/Users/Shared/Projects/reply`

### Summary

| Relation | Status | Notes |
| --- | --- | --- |
| Hub API | healthy | live runtime observed on both `/api/health` and `/api/system/health` |
| Background worker | healthy | worker online and bridge outbox replay loop active |
| `reply.app` installed bundle | healthy | required bundle paths present in `/Applications/reply.app` |
| `reply-helper` installed bundle | healthy | helper present in installed app bundle |
| launchd `com.reply.hub` | optional / inactive during audit | session-owned runtime active on this machine |
| Node.js | healthy | local Node runtime available and current repo scripts pass |
| Python | healthy | Python 3.12+ requirement satisfied |
| Swift / Xcode | healthy | native toolchain present |
| `{trinity}` repo presence | healthy | sibling repo exists at `/Users/Shared/Projects/trinity` |
| `{trinity}` end-to-end verification | degraded but bounded | smoke test now fails fast instead of hanging indefinitely when `suggest` stalls |
| `{train}` handoff path | bounded but still dependent on Trinity health | export/proposal contract remains downstream of the Trinity smoke path |
| Ollama | healthy during latest live probe | current health payload reported `online` |
| OpenClaw binary | healthy | verify script resolved a valid binary |
| OpenClaw gateway | healthy | health/preflight reported `online` |
| iMessage source access | healthy with separate source-specific risk | source readable; Apple-source and Lance concurrency remain areas to watch |
| WhatsApp source access | readable but degraded in latest runtime snapshot | latest health showed a Lance create-index conflict |
| Gmail connector | healthy | connected account present in health |
| IMAP | not configured | no active IMAP relation on this machine |
| Mail.app fallback | present but not freshly exercised | code path exists |
| Apple Calendar | healthy | active sync status present |
| Apple Contacts | healthy | completed sync status present |
| Apple Notes | healthy | up-to-date sync status present |
| LinkedIn browser bridge | healthy | live bridge replay succeeded and `relations.linkedin_ingest.status` returned `online` |
| Bridge outbox durability | healthy | pending bridge queue reconciles persisted rows and now drains to `[]` |

### Evidence Collected

- regression checks passed:
  - `node --test chat/test/brain-runtime.test.js chat/test/relation-hardening.test.js chat/test/system-health-shape.test.js`
- live bridge request returned `200` against `POST /api/channel-bridge/inbound`
- `~/Library/Application Support/reply/channel_bridge_pending.json` was reconciled back to `[]`
- queued LinkedIn bridge row was verified in `unified_messages`
- current server aliases include:
  - `/api/health`
  - `/api/system-health`
  - `/api/system/health`
  - `/api/system/services`

## Current Weak Spots

### 1. Trinity is bounded but not yet truly healthy

The failure mode is much better now because `suggest` no longer hangs forever, but degraded Trinity latency is still real operational risk. The product survives it; the underlying runtime still needs root-cause work.

### 2. WhatsApp / Lance concurrency is still a live hardening target

The latest health snapshot showed a retryable Lance create-index conflict on the WhatsApp path. That is separate from the bridge outbox fix and should be treated as the next storage/concurrency hardening pass.

### 3. Status presentation can lag behind reconciled bridge state

The bridge queue now reconciles persisted rows correctly, but human-readable status text may still reflect the earlier queued state until the next status refresh overwrites it. The durability issue is fixed; the presentation path still needs cleanup.

### 4. Multiple runtime shapes still exist

Session-owned runtime, native app-managed runtime, and LaunchAgent mode are all valid. Health now reports runtime mode explicitly, but these paths still need continuous documentation discipline.

## Hardening Recommendations

### Highest priority

1. Make the Trinity smoke test bounded and fail-fast.
   - Add explicit timeouts around `suggest`, `record-outcome`, `export-trace`, and policy proposal calls in `chat/scripts/verify-trinity-train-integration.js`.
   - Emit step-by-step timing so hangs identify the failing edge immediately.

2. Fix schema drift in the annotation/vector path.
   - Treat the `annotation_tags` mismatch as a release-blocking data contract bug.
   - Add startup schema validation or migration checks before the worker begins annotation runs.

3. Reduce LinkedIn ingest to one supported path.
   - Pick one primary relation: extension, userscript, or Playwright sidecar.
   - Keep the others explicitly marked as dev-only or fallback-only.
   - Add a health probe that tells the operator which LinkedIn ingest mode is currently configured and alive.

### Medium priority

4. Add a first-class relation health matrix endpoint.
   - Expose one API payload that reports each major relation separately:
     - repo/runtime presence
     - auth/config present
     - transport reachable
     - last successful use
     - last failure
   - This is more actionable than the current coarse service/channel mix.

5. Normalize route names and document them once.
   - Either add `/api/system/health` as an alias or standardize on `/api/system-health` everywhere.
   - Avoid operational drift between docs, scripts, and habits.

6. Unify runtime mode reporting.
   - Surface whether the current hub is:
     - native app-managed
     - foreground session mode
     - LaunchAgent mode
   - This should be explicit in health output.

### Lower priority but still worth doing

7. Add active self-tests for Mail.app fallback and LinkedIn handoff.
   - Even if they remain human-in-the-loop, the app should verify that the automation prerequisites exist.

8. Mark non-first-class bridge channels clearly.
   - If Telegram, Discord, Messenger, Instagram, Signal, Viber, and SMS are only vocabulary-level today, document them as such and avoid implying parity with supported channels.
