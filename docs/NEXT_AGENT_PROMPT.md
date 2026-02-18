# Next Agent Continuation Prompt

Generated: 2026-02-18 07:33:49 UTC
Trigger: User requested 70% context handover

## Session Snapshot

- Branch: `main`
- Working tree: clean

## Objective

Stabilize WhatsApp Desktop send automation and fix conversations indexing (order/search/counts/preview).

## Completed

- Email dashboard counts now include Gmail/IMAP/Mail/mbox sources (fixes Email Sync showing 0).
- Added Gmail Settings: Sync scope (Inbox+Sent / All Mail / Custom query).
- Added SSOT issues #196 and #197 to Project 1 and set fields (Ready, reply, Agnes).

## In Progress

- WhatsApp Desktop send automation still flaky on real UI states; needs focus/search/composer stabilization (#196).
- Contacts list endpoint /api/conversations is stuck in meta.mode=fallback because db-index helpers are not wired; q= search effectively disabled (#197).

## Immediate Next Actions

- Reproduce WhatsApp failures on WhatsApp vs WhatsApp Beta; capture failing AX roles/positions; tighten AppleScript steps and error messages; keep dryRun.
- Implement a db-built conversations index (count + last preview + last channel/source) with caching/invalidation; wire server-side query matching and UI search input.

## Known Blockers

- WhatsApp UI scripting is brittle and varies by app build/window state; requires real UI verification.
- Dev shell PATH is non-standard; prefer absolute paths (/bin/ls, /usr/bin/curl, /usr/bin/python3).

## Validation Commands

- /usr/bin/curl -sS http://localhost:3000/api/system-health | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["channels"]["mail"]["processed"])'
- /usr/bin/curl -sS 'http://localhost:3000/api/conversations?offset=0&limit=10&q=csaba' | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("meta")); print([c.get("displayName") for c in d.get("contacts",[])])'
- /usr/bin/curl -sS -X POST http://localhost:3000/api/send-whatsapp -H 'Content-Type: application/json' -d '{"recipient":"+36706010707","text":"dryRun","dryRun":true}'

## Notes

- Local WIP: branch `codex/wip-conversations-index` (commit `788e3f3`) contains a partial implementation of conversations index cache + sidebar `q=` wiring.

## Docs To Read First

- docs/HANDOVER.md
- docs/PROJECT_MANAGEMENT.md
- /Users/moldovancsaba/Projects/memory/2026-02-18.md

## Copy-Paste Prompt For The Next Agent

```text
You are taking over from a previous agent because context usage reached the handover threshold.

Follow this order:
1. Read these docs first: /Users/moldovancsaba/Projects/reply/docs/HANDOVER.md, /Users/moldovancsaba/Projects/reply/docs/PROJECT_MANAGEMENT.md, /Users/moldovancsaba/Projects/memory/2026-02-18.md.
2. Continue this objective: Stabilize WhatsApp Desktop send automation and fix conversations indexing (order/search/counts/preview).
3. Preserve existing decisions; do not reopen settled architectural choices unless a blocker requires it.
4. SSOT rule: track Reply work only in moldovancsaba/mvp-factory-control issues + Project 1.
5. Execute immediate next actions:
 - Reproduce WhatsApp failures on WhatsApp vs WhatsApp Beta; capture failing AX roles/positions; tighten AppleScript steps and error messages; keep dryRun.
 - Implement a db-built conversations index (count + last preview + last channel/source) with caching/invalidation; wire server-side query matching and UI search input.
  - Optional: inspect local WIP branch `codex/wip-conversations-index` (`git fetch --all`, `git checkout codex/wip-conversations-index`).
6. Run validations:
 - /usr/bin/curl -sS http://localhost:3000/api/system-health | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["channels"]["mail"]["processed"])'
 - /usr/bin/curl -sS 'http://localhost:3000/api/conversations?offset=0&limit=10&q=csaba' | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("meta")); print([c.get("displayName") for c in d.get("contacts",[])])'
 - /usr/bin/curl -sS -X POST http://localhost:3000/api/send-whatsapp -H 'Content-Type: application/json' -d '{"recipient":"+36706010707","text":"dryRun","dryRun":true}'
7. If a blocker prevents progress, update the handover doc and refresh this continuation prompt before ending the window.

```
