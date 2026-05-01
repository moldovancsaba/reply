# Handover

## Current State

- Repo root is now `/Users/Shared/Projects/reply`.
- The local hub is running successfully from the relocated repo root.
- LaunchAgent `com.reply.hub` has been regenerated to point at `/Users/Shared/Projects/reply/tools/scripts/reply_service.sh`.
- Old hardcoded runtime fallback to `/Users/moldovancsaba/Projects/reply` has been removed.
- Repo-local path references that still pointed at the old checkout path have been updated.
- The LinkedIn Chrome extension manifest now matches the current localhost port-scan behavior.
- Archived board-export payloads and ad hoc GraphQL mutation files are now treated as ignored local artifacts, not active repo inputs.

## Latest Changes

### 2026-05-01

- Removed the hardcoded repo-root fallback from [app/reply-app/Sources/ReplyCoreService.swift](/Users/Shared/Projects/reply/app/reply-app/Sources/ReplyCoreService.swift).
- Made [scripts/verify-foundation.sh](/Users/Shared/Projects/reply/scripts/verify-foundation.sh) resolve the repo root dynamically from the script location.
- Relocated the checkout from `/Users/moldovancsaba/Projects/reply` to `/Users/Shared/Projects/reply`.
- Reinstalled the LaunchAgent from the new repo root so `WorkingDirectory` and `ProgramArguments` now point at `/Users/Shared/Projects/reply`.
- Updated stale documentation references in:
  - [docs/SPRINT_PLAN_2W.md](/Users/Shared/Projects/reply/docs/SPRINT_PLAN_2W.md)
  - [docs/CHANNEL_BRIDGE.md](/Users/Shared/Projects/reply/docs/CHANNEL_BRIDGE.md)
  - [docs/NATIVE_MACOS_APP_PLAN.md](/Users/Shared/Projects/reply/docs/NATIVE_MACOS_APP_PLAN.md)
- Added repo operator notes in [AGENTS.md](/Users/Shared/Projects/reply/AGENTS.md).
- Added `npm run verify:openclaw` and aligned the Chrome extension manifest with localhost scanning.

## Validation

- `make install-service`
  - Result: regenerated `~/Library/LaunchAgents/com.reply.hub.plist` with `/Users/Shared/Projects/reply` paths.
- `make status`
  - Result: LaunchAgent running, hub running from the new repo, `/api/health` returned `ok: true`.
- `rg -n '/Users/moldovancsaba/Projects/reply' /Users/Shared/Projects/reply`
  - Result: no matches.

## Known Notes

- There are unrelated existing working-tree changes in the repo. They were left untouched.
- `READMEDEV.md` expects this general handover file to exist; that expectation is now satisfied.
- LinkedIn archive import handover remains documented separately in [docs/HANDOVER_LINKEDIN_IMPORT.md](/Users/Shared/Projects/reply/docs/HANDOVER_LINKEDIN_IMPORT.md).

## Immediate Next Actions

1. Use `/Users/Shared/Projects/reply` as the canonical local checkout path in future ops and docs.
2. If the native app is launched again from source, rebuild it from the relocated repo root.
3. Keep `docs/HANDOVER.md` updated whenever runtime paths, startup workflow, or operational state changes.
