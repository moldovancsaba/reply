# Next Agent Continuation Prompt

Generated: 2026-02-18 07:42:20 UTC
Trigger: User requested 70% context handover

## Session Snapshot

- Branch: `main`
- Working tree changes:
- M docs/HANDOVER.md
- M docs/USER_GUIDE.md

## Objective

Stabilize WhatsApp Desktop send automation and fix conversations indexing (order/search/counts/preview).

## Completed

- Docs: clarified navigation/SSOT/architecture/board queries; pushed to origin/main (commit 08d1c69).
- Board: normalized all Reply issue titles to '{reply}: …' (no 'Reply Hub', no prefixes).
- Board: added Idea Bank issue #195 '{reply}: Manage multiple mailboxes' (P2).

## In Progress

- WhatsApp Desktop send automation still flaky on real UI states (#196).
- Conversation list indexing/order/search/counts still needs cleanup (#197).

## Immediate Next Actions

- Reproduce WhatsApp failures on WhatsApp vs WhatsApp Beta; capture failing AX roles/positions; tighten AppleScript steps and error messages; keep dryRun.
- Finish conversations index work: make /api/conversations meta.mode=db with correct ordering + server-side q= search + accurate counts/previews.
- Optionally inspect branch codex/wip-conversations-index for partial implementation.

## Known Blockers

- WhatsApp UI scripting varies by app build/window state; requires real UI verification.
- Dev shell PATH is non-standard; prefer absolute paths (/bin/ls, /usr/bin/curl, /usr/bin/python3).

## Validation Commands

- /usr/bin/curl -sS http://localhost:3000/api/system-health | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["channels"]["mail"]["processed"])'
- /usr/bin/curl -sS 'http://localhost:3000/api/conversations?offset=0&limit=10&q=csaba' | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("meta")); print([c.get("displayName") for c in d.get("contacts",[])])'
- /usr/bin/curl -sS -X POST http://localhost:3000/api/send-whatsapp -H 'Content-Type: application/json' -d '{"recipient":"+36706010707","text":"dryRun","dryRun":true}'

## Notes

- SSOT: track work only in moldovancsaba/mvp-factory-control issues + Project 1; product repo issues are disabled.
- Email: Gmail OAuth is live and includes sync scope (Inbox+Sent/All Mail/Custom query).
- WhatsApp send is best-effort until #196 is closed.

## Docs To Read First

- /Users/moldovancsaba/Projects/reply/docs/HANDOVER.md
- /Users/moldovancsaba/Projects/reply/docs/PROJECT_MANAGEMENT.md
- /Users/moldovancsaba/Projects/reply/docs/APP_NAVIGATION.md
- /Users/moldovancsaba/Projects/memory/2026-02-18.md

## Copy-Paste Prompt For The Next Agent

```text
You are taking over from a previous agent because context usage reached the handover threshold.

Follow this order:
1. Read these docs first: /Users/moldovancsaba/Projects/reply/docs/HANDOVER.md, /Users/moldovancsaba/Projects/reply/docs/PROJECT_MANAGEMENT.md, /Users/moldovancsaba/Projects/reply/docs/APP_NAVIGATION.md, /Users/moldovancsaba/Projects/memory/2026-02-18.md.
2. Continue this objective: Stabilize WhatsApp Desktop send automation and fix conversations indexing (order/search/counts/preview).
3. Preserve existing decisions; do not reopen settled architectural choices unless a blocker requires it.
4. Execute immediate next actions:
- Reproduce WhatsApp failures on WhatsApp vs WhatsApp Beta; capture failing AX roles/positions; tighten AppleScript steps and error messages; keep dryRun.
- Finish conversations index work: make /api/conversations meta.mode=db with correct ordering + server-side q= search + accurate counts/previews.
- Optionally inspect branch codex/wip-conversations-index for partial implementation.
5. Run validations:
- /usr/bin/curl -sS http://localhost:3000/api/system-health | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["channels"]["mail"]["processed"])'
- /usr/bin/curl -sS 'http://localhost:3000/api/conversations?offset=0&limit=10&q=csaba' | /usr/bin/python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("meta")); print([c.get("displayName") for c in d.get("contacts",[])])'
- /usr/bin/curl -sS -X POST http://localhost:3000/api/send-whatsapp -H 'Content-Type: application/json' -d '{"recipient":"+36706010707","text":"dryRun","dryRun":true}'
6. If a blocker prevents progress, update the handover doc and refresh this continuation prompt before ending the window.

```
