# {reply} Project Dependencies & Blocking Relationships

**Doc freshness:** 2026-04-11 — Planning map with **legacy mvp-factory-control issue IDs** in headings below. **Execution SSOT:** [Project #7](https://github.com/users/moldovancsaba/projects/7) + [`moldovancsaba/reply` issues](https://github.com/moldovancsaba/reply/issues). When this file disagrees with the board or `docs/HANDOVER.md`, update this file or add an explicit “historical” note.

**Document Status**: Planning archive (critical path narrative)  
**Last Updated**: 2026-04-11  
**Owner**: AI Developer  
**Sync Requirement**: Update when critical path assumptions change (not every card move).

---

## Critical Path Analysis

This document maps **historical** blocking relationships between `{reply}`-themed issues (many originally filed in **mvp-factory-control**) to show how work was sequenced. It is **not** a substitute for the live GitHub board.

### TIER 1: Foundation (legacy IDs)

**#212: CI Pipeline (GitHub Actions lint + test)**
- **Status (2026-04):** **Verified on `moldovancsaba/reply` `main`** — `.github/workflows/ci.yml` runs Node **20**, `npm run lint`, `npm test`, informational `npm audit`.
- **Blocks (historical):** Was a gate before large refactors.

**#213: Parameterized SQL (security audit)**
- **Status (2026-04):** **Verified safe** for the audited patterns (see HANDOVER / security history); treat new SQL as reviewable surface area.

**#197: Conversation Indexing Cleanup**
- **Status:** Historical “in progress” item — **current API** exposes `meta.sort` / `meta.sortRequested` / `meta.sortValid` on `/api/conversations`. Prefer new **reply** issues + Project #7 for remaining indexing/search work.

---

### TIER 2: Security & Architecture (High priority)

**#211: Decompose server.js into route modules**
- **Status (2026-04):** **Largely delivered** in-repo (`chat/routes/*`, thin `chat/server.js`). Any open “#211” scope in **reply** should be **retitled** to concrete remaining work (new routes, split a specific module), not “decompose monolith” from scratch.
- **Historical blocks:** #214, #220, #221, #223, #224 were described as depending on modular routes — validate each on the board before assuming blockers still apply.

**#214: Loading States + Error Toasts**
- **Status**: Backlog
- **Depends On**: Nothing (independent)
- **Unblocks**: Better perceived performance before #211
- **Estimated Duration**: 1-2 days
- **Can Start**: Immediately (no dependencies)

---

### TIER 3: Settings & Config (Medium priority)

**#223: AI Provider Cards (Ollama/OpenClaw health, config, selector)**
- **Status**: Backlog
- **Depends On**: #211 (cleaner routes for settings API)
- **Blocks**: #221, #224 (parent feature)
- **Estimated Duration**: 2-3 days (after #211)

**#221: Settings IA Card Hub (consolidation)**
- **Status**: Backlog
- **Depends On**: #223, #224 (should be decomposed)
- **Blocks**: Nothing (integrator)
- **Estimated Duration**: 1-2 days (after #223, #224)

**#224: Smart Prompt Library (templates + chaining)** *(canonical title; was also described as “per-channel settings matrix” in older drafts)*
- **Status**: Backlog (historical)
- **Depends On**: #223 (AI provider config must come first), #211 (historical — routes now modular; re-validate)
- **Blocks**: #221 (parent feature)
- **Estimated Duration**: 2-3 days (after #211, #223)

---

### TIER 4: Channel Enablement

**#220: LinkedIn Channel Enablement**
- **Status**: Backlog
- **Depends On**: #211 (channel routes), Scoping clarification
- **Blocked By**: Architectural decision on send vs inbound-only
- **Estimated Duration**: 2-3 days
- **⚠️ BLOCKER**: Need to clarify scope before starting

**#201: Secure Digital-Me Memory Index**
- **Status**: Backlog
- **Depends On**: #213 (safe SQL), #211 (modular routes)
- **Blocked By**: Design phase
- **Estimated Duration**: 2-3 days (after foundation)

---

### TIER 5: Polish & Documentation

**#215: First-run Onboarding Wizard**
- **Status**: Backlog
- **Depends On**: #214 (loading states), #223 (provider setup)
- **Estimated Duration**: 3-4 days

**#216: Mobile Responsiveness + Accessibility**
- **Status**: Backlog
- **Depends On**: Nothing (independent)
- **Can Run In Parallel**: Yes

**#217: Local Analytics Instrumentation**
- **Status**: Backlog
- **Depends On**: Nothing (independent)
- **Can Run In Parallel**: Yes

**#218: Data Export CLI**
- **Status**: Backlog
- **Depends On**: Nothing (independent)
- **Can Run In Parallel**: Yes

**#219: Version Strategy + Changelog**
- **Status**: Backlog
- **Depends On**: #212 (CI pipeline for releases)
- **Estimated Duration**: 4-8 hours

---

## Dependency Graph

```
┌──────────────────────────────────────────────────┐
│ FOUNDATION LAYER (MUST DO FIRST)                 │
├─────────────────┬──────────────┬────────────────┤
│ #212: CI        │ #213: SQL    │ #197: Indexing │
│ (Tests guard)   │ (Security)   │ (In Progress)  │
└────────┬────────┴───────┬──────┴────────┬───────┘
         │                │                │
         └────────────────┼────────────────┘
                          ▼
         ┌─────────────────────────────────┐
         │ #211: Routes modular (done)     │
         │ (historical gate — validate)    │
         └────┬────────────────────────┬───┘
              │                        │
    ┌─────────┼───────────────────────┼─────────┐
    ▼         ▼                       ▼         ▼
  #214:    #223: AI Config        #220:      #221:
  Load     (Ollama/OpenClaw)     LinkedIn   Settings
  States       │                  (Channel)  Hub
    │          └────────┬─────────┘          ╱  │
    │                   ▼                   ╱   │
    │              #224: Per-Ch         ◄──┘    │
    │              Settings                     │
    │                   │                       │
    └───────────────────┼───────────────────────┘
                        ▼
         ┌──────────────────────────────────┐
         │ Phase 4: Polish & Extra          │
         │ #215: Onboarding                 │
         │ #216: Mobile Responsiveness      │
         │ #217: Analytics                  │
         │ #218: Data Export CLI            │
         │ #219: Version Strategy           │
         └──────────────────────────────────┘
```

---

## Wait-For Matrix

| Issue | Waiting For | Reason | Est. Wait |
|-------|------------|--------|-----------|
| #211 | (historical) | Monolith split largely done — open new reply issues for any remaining modularization | — |
| #223 | #211 | Need clean routes for settings API | +1 week |
| #224 | #223 + #211 | Channel routes + AI config must exist | +1 week |
| #221 | #223 + #224 | Should decompose parent features first | +1 week |
| #220 | #211 + Scoping | Need channel abstraction + clarify scope | 1-2 weeks |
| #215 | #214 + #223 | Loading states + provider setup needed | +2 weeks |
| #201 | #213 + #211 | SQL safety + modular routes | 2-3 weeks |
| #219 | #212 | CI pipeline for release automation | 1 week |

---

## Critical Path Summary

**Fastest possible path to ship all high-priority items:**

1. **Day 1-3**: Verify #212, #213 (foundation)
2. **Day 4-7**: Complete #211 (major refactor)
3. **Day 8-10**: Ship #214 (quick win, can overlap #211)
4. **Day 11-14**: Complete #223 (AI config)
5. **Day 15-17**: Complete #224, #221 (settings features)

**Total: 17 days for all P1/P2 core features (3+ weeks)**

---

## Risk & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| #211 regression (refactor breaks endpoints) | Medium | High | Full test suite before/after; rollback branch ready |
| #197 doesn't unblock #221 | Low | Medium | Clarify blocker status now; document if client-side OK |
| #212 CI not working | Low | High | Test locally first; use GitHub Actions docs |
| #213 SQL audit incomplete | Medium | High | Run audit before marking done; document all findings |
| #223 config breaks LLM | Low | High | Health checks + validation; test offline Ollama |
| #224 channel breakage | Low | High | Test each channel inbound/outbound after changes |

---

## Update Protocol

**This document is LIVE and must be updated:**
- ✅ Every time an issue status changes
- ✅ Every time a blocker is discovered
- ✅ Every time a dependency is added/removed
- ✅ Every Friday (weekly sync)

**Sync checklist:**
- [ ] Run `gh project item-list 7 --owner moldovancsaba --format json --limit 500` and compare to this document’s **assumptions** (not every card).
- [ ] Update any material discrepancies or mark sections **historical**.
- [ ] Commit changes with message: `docs: sync dependency map with board status`

**Next scheduled update**: When critical path or foundation assumptions change
