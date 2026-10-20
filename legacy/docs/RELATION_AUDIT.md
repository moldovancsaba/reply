# `{reply}` Relation Audit

**Doc freshness:** 2026-05-21  
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

**Audit date:** 2026-05-21  
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
| `{trinity}` end-to-end verification | healthy with automatic provider fallback | smoke is green again, runtime diagnostics are emitted, and this machine now auto-resolves from a misconfigured `mistral-cli` route to an effective Ollama route instead of hanging or collapsing to opaque fallback behavior |
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
| Relation health matrix | healthy | major relations now report active mode, last success, last failure, failure class, and recovery state |
| Foundation verification gate | healthy | repo now exposes `make verify-foundation` / `npm run verify:foundation` and CI runs the same core gate |

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

### 1. Trinity is bounded, diagnosable, and now completes the smoke path, but provider configuration is still not fully aligned

The failure mode is much better now because `suggest` no longer hangs forever, prepared drafts can be recovered before local fallback, the smoke path completes inside the runtime budget, and relation health surfaces recent runtime timing. On this machine, current Trinity runtime diagnostics show that the configured `mistral-cli` route auto-resolves to an effective Ollama route when `MISTRAL_API_KEY` is missing. The service is now self-healing and operator-safe, but the configured-provider story is still not clean until the intended provider is either restored or the runtime configuration is updated to match the healthy effective route.

### 2. WhatsApp / Lance concurrency risk is reduced, but still the next storage edge to watch

The write-path hardening now serializes LanceDB writes and stops force-recreating the text index on each mutation. That removes the largest self-inflicted concurrency source. WhatsApp should still stay on the watch list until repeated live sync runs confirm that the remaining Lance conflict no longer recurs in practice.

### 3. Status presentation is much better, but still depends on fresh runtime evidence

The bridge queue now reconciles persisted rows correctly and recovered LinkedIn state is no longer forced to show a stale error as the active relation failure. Human-readable status still depends on current runtime evidence, so stale local status files can still mislead until the next successful refresh.

### 4. Multiple runtime shapes still exist

Session-owned runtime, native app-managed runtime, and LaunchAgent mode are all valid. Health now reports runtime mode explicitly, but these paths still need continuous documentation discipline.

## Hardening Recommendations

### Highest priority

1. Align the configured Trinity provider with the healthy effective route.
   - `{reply}` now contains failure safely and surfaces recent timing/provider data.
   - The next step on this machine is to either configure `MISTRAL_API_KEY` for the intended `mistral-cli` route or update the active Trinity runtime config so Ollama is the declared primary route instead of only the automatic recovery path.

2. Keep exercising the WhatsApp/Lance path under live sync load.
   - The largest write/index contention source is now removed.
   - The next check is repeated live validation, not another speculative storage rewrite.

3. Continue collapsing integrations to one primary runtime path per relation.
   - LinkedIn now treats `browser_bridge` as the primary relation and sidecar as explicit-only.
   - Keep the same discipline for any other multi-path channel.

### Medium priority

4. Keep the relation health matrix canonical.
   - It now exists and reports causal relation state.
   - New runtime surfaces should extend it instead of inventing ad hoc service flags.

5. Keep the verification gate as a release requirement.
   - `make verify-foundation` should stay green before runtime-facing changes ship.
   - CI now runs the same core gate plus a native macOS build job.

6. Keep runtime mode reporting explicit everywhere operators can see health.
   - Session, native app-managed, and LaunchAgent modes are now part of health truth.
   - Future docs and UI changes should preserve that explicitness.

### Lower priority but still worth doing

7. Add active self-tests for Mail.app fallback and LinkedIn handoff.
   - Even if they remain human-in-the-loop, the app should verify that the automation prerequisites exist.

8. Mark non-first-class bridge channels clearly.
   - If Telegram, Discord, Messenger, Instagram, Signal, Viber, and SMS are only vocabulary-level today, document them as such and avoid implying parity with supported channels.
