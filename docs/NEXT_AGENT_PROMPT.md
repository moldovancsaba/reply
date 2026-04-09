# Next Agent Continuation Prompt

**Project:** {reply}
**Last Updated:** 2026-03-02 19:42 UTC
**Status:** v0.4.5 Released (Fixes: Settings Persistence, Sync Depth, KYC Speed)

---

## Developer Agent Guidelines

You are a Developer Agent working on `{reply}`. Follow these operating principles at all times.

### Operating Principles
- **Be explicit, evidence-driven, and reversible**: small edits, minimal blast radius, clear rollback.
- **Prefer “prove it” over “trust me”**: include commands run + outputs/observations.
- **Keep the board and handover current** as you work (not at the end).
- **Absolute Mandate – Documentation = Code**: Documentation must be maintained with the same rigor as code. Never use placeholders. Every logic/file/feature update must trigger an immediate documentation refresh.

### Definition of Done (DoD)
1. **Scope & acceptance**: Match the issue/card acceptance criteria explicitly.
2. **Quality gates**: Build passes, tests pass, no new warnings/errors.
3. **Implementation hygiene**: Minimal, coherent changes. No secrets committed.
4. **Evidence & documentation**: Provide what/where/how/results. Update [docs/HANDOVER.md](./docs/HANDOVER.md) and [docs/RELEASE_NOTES.md](./docs/RELEASE_NOTES.md). Update the project board with correct status + concise notes.

### Board Discipline (SSOT)
- **Board URL (`{reply}`)**: https://github.com/users/moldovancsaba/projects/7
- **Issues Repo**: `moldovancsaba/reply`
- **Action**: Move selected card to “In Progress” when starting. Move to “Done” with validation evidence.

---

## 70 Protocol (Handover)

**Trigger:** Context usage reaching threshold.

### A) Session Snapshot
- **Branch:** `main`
- **Objective:** Fix Gmail sync depth, settings persistence (API key loss), and KYC speed.
- **Status:** **DONE**. Version 0.4.5 is fully released and verified.

### B) What Changed in this Session
- **Settings Persistence Fixed**: Resolved bug in `settings-store.js:withDefaults` that wiped secrets during security token updates.
- **Gmail Sync Depth**: Increased limit to 10,000 messages in `gmail-connector.js`.
- **KYC Performance**: Increased auto-scan speed to 20/hr (cap 60/hr) via `.env`.
- **Standalone Settings**: Completed migration to `settings.html` + `settings-fragment.html`.
- **Operator Token**: Transitioned to automatic injection via `server.js`.

### C) Immediate Next Actions
1. **Gmail Reconnect**: **USER ACTION REQUIRED**. Re-authenticate Gmail in Settings to restore the secrets wiped during today's upgrade.
2. **Monitor KYC**: Confirm that contact intelligence advances at the new rate of ~480/day.
3. **Refactor server.js**: (Issue #211) Decompose monolithic routes into modules.

### D) Validation Commands
- `cd ./chat && npm test`
- `curl -s http://127.0.0.1:45311/api/health | jq`
- `make status`

---

## Copy-Paste Prompt For The Next Agent

```text
You are a Developer Agent taking over the {reply} project.
1. Read ./docs/HANDOVER.md and ./docs/PROJECT_MANAGEMENT.md first.
2. Verify the current state by running: cd ./chat && npm test
3. Objective: Continue post-v0.4.5 stabilization and begin Issue #211 (server.js decomposition).
4. Follow the "Developer Agent Guidelines" and "70 Protocol" in ./docs/NEXT_AGENT_PROMPT.md.
5. Project Board: https://github.com/users/moldovancsaba/projects/7 (`{reply}` project).
```
