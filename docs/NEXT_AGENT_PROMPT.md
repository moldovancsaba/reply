# Next Agent Continuation Prompt

**Doc freshness:** 2026-04-11 — `{reply}` SSOT is **[Project #7](https://github.com/users/moldovancsaba/projects/7)** + **[moldovancsaba/reply](https://github.com/moldovancsaba/reply) issues** + **[HANDOVER.md](./HANDOVER.md)** (especially “Active Session Update”). This file is a **boot prompt**, not a backlog.

**Product / release:** See `chat/package.json` `version` and [RELEASE_NOTES.md](./RELEASE_NOTES.md) for shipped facts.

---

## Developer Agent Guidelines

You are a Developer Agent working on `{reply}`. Follow these operating principles at all times.

### Operating Principles
- **Be explicit, evidence-driven, and reversible**: small edits, minimal blast radius, clear rollback.
- **Prefer “prove it” over “trust me”**: include commands run + outputs/observations.
- **Keep the board and handover current** as you work (not at the end).
- **Documentation = code**: when behavior changes, update the same PR: `docs/HANDOVER.md`, and `docs/RELEASE_NOTES.md` **only** for shipped user-visible changes.

### Definition of Done (DoD)
1. **Scope & acceptance**: Match the issue/card acceptance criteria explicitly.
2. **Quality gates**: `cd chat && npm test` and `npm run lint` pass on touched code.
3. **No secrets** in commits, logs, or docs.
4. **Evidence**: comment on the issue + move the Project #7 card with a one-line validation note.

### Board Discipline (SSOT)
- **Board:** https://github.com/users/moldovancsaba/projects/7
- **Issues:** https://github.com/moldovancsaba/reply/issues
- Move card to **In Progress** when starting; **Done** only with verification.

---

## 70 Protocol (Handover)

**Trigger:** Context usage reaching threshold.

### A) Session Snapshot
- **Branch:** `main` (unless PO says otherwise).
- **Objective:** (one line — copy from the card you are doing.)
- **Status:** In progress / blocked / done.

### B) What changed
- Bullets + file paths.

### C) Immediate next actions
- 1–3 bullets for the **next** agent (usually: next card on Project #7).

### D) Validation commands
```bash
cd chat && npm test
cd chat && npm run lint
curl -s "http://127.0.0.1:45311/api/health" | head -c 500   # hub must be running; port from PORT / .env
```

---

## Copy-paste prompt for the next agent

```text
You are a Developer Agent taking over {reply}.
1. Read docs/HANDOVER.md (Active Session + SSOT section) and docs/PROJECT_MANAGEMENT.md.
2. Open https://github.com/users/moldovancsaba/projects/7 — pick the highest-priority open card.
3. Run: cd chat && npm test
4. Implement the card; update HANDOVER.md; comment on the issue; move the card on Project #7.
5. Do not redo completed foundation work (CI, modular routes) unless a new issue explicitly reopens it.
```
