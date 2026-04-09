# {reply} Brain Dump — Live Knowledge Repository

**Purpose**: Single source of truth for all accumulated knowledge, decisions, context, and operational state.  
**Owner**: AI Developer  
**Last Updated**: 2026-02-22  
**Update Frequency**: After every issue completion + weekly sync

---

## Current Operational State (2026-02-22)

### Active Work (This Sprint)
- **Sprint 1 & 2 Planning**: Complete (docs created: DEPENDENCY_MAP, BACKLOG_PRIORITIZATION, SPRINT_PLAN_2W)
- **Foundation Verification**: #212 (CI Pipeline), #213 (SQL Audit) — status unknown, marked for verification
- **In Progress**: #197 (Conversation Indexing), #194 (Message Counts Fix — likely complete but needs confirmation), #202 (Omnichannel Routing)
- **Ready to Start**: #214 (Loading States + Error Toasts) — independent, no blockers

### Board Status Summary (as of 2026-02-22)
- **Total {reply} issues**: 64
- **Done**: 23 issues (mostly completed by Agnes)
- **In Progress**: 3 issues (#194, #197, #202)
- **Review**: 4 issues (#187, #188, #189, #193)
- **Ready**: 1 issue (#174 Context Engine)
- **Roadmap**: 1 issue (#167 Local Ollama agent)
- **Backlog**: 22 issues (#211–#224, etc.)
- **IDEA BANK**: 13 issues (future features, low priority)
- **Unspecified Status**: 1 issue (#171 Ingestion, #172 Hybrid Search, #173 Unified Brain)

### Critical Issues Identified

#### Verification Completed ✅
1. **#212 (CI Pipeline)** — ✅ VERIFIED WORKING
   - Status: `.github/workflows/ci.yml` exists and configured correctly
   - Runs: ESLint + Jest tests on push/PR to main branch
   - Node: v18 (matches team standard)
   - Impact: **No blocker** — #211 refactor can proceed

2. **#213 (SQL Audit)** — ✅ VERIFIED SAFE
   - Findings: 4 instances of string-interpolated SQL in vector-store.js + channel-bridge.js
   - Mitigation: ALL use `escapeSqlString()` function (escapes single quotes)
   - Assessment: No injection vulnerability detected (LanceDB syntax validated)
   - Impact: **No blocker** — safe to proceed with #211

3. **#194 (Message Count Fix)** — Verification Pending
   - Action: Check UI counts vs LanceDB source vs email API
   - Status: Code inspection shows 2026-02-18 fix applied
   - Next: Functional verification required

#### Major Upcoming Work
1. **#211 (Decompose server.js)** — ~3-4 days
   - Blocked by: #212, #213 verification
   - Unblocks: 5 downstream features (#214, #220, #221, #223, #224)
   - Risk: High (large refactor, need full test coverage)

2. **#223 (AI Provider Cards)** — ~2-3 days implementation
   - Depends on: #211 complete
   - Why: Need clean routes for settings API
   - Unblocks: #221, #224 (settings features)

3. **#214 (Loading States + Toasts)** — ~1-2 days
   - Independent: Can start now (no blockers)
   - Quick win: UX improvement, low risk
   - Recommended: Start in parallel with #211 prep

---

## Technical Architecture & Design Decisions

### Core Stack (Locked)
- **Runtime**: Node.js 18+ LTS
- **Frontend**: Vanilla JS (no framework) + HTML/CSS
- **Database**: SQLite (contact-store, message indexing)
- **Vector DB**: LanceDB (semantic search)
- **LLM**: Ollama (local) or OpenClaw (remote)
- **Message Transports**:
  - iMessage: AppleScript (native macOS)
  - WhatsApp: Desktop automation + OpenClaw CLI fallback
  - Email: Gmail API (preferred) + Mail.app fallback (IMAP fallback)
  - LinkedIn: Clipboard paste + browser open (no public API)
  - Bridge channels: Telegram, Discord, Signal, Viber (inbound-only, draft-only)

### Architectural Principles
1. **Local-first**: All message history stays on device (no cloud sync)
2. **Air-gapped**: No external API calls except Gmail/Ollama/OpenClaw (user-configured)
3. **Human-in-loop**: All send operations require human trigger (security policy)
4. **Bounded resources**: Max caches (5000 WhatsApp LID mappings, 50 messages per contact for LLM)
5. **Modular routes**: Post-#211 refactor, each transport has own route file

### Security Posture
- ✅ Local-only writes (loopback IP check)
- ✅ Operator token enforcement (optional, recommended for production)
- ✅ Human approval gates on all send + mutation routes
- ✅ Rate limiting (30 req/min on 12 sensitive endpoints)
- ✅ CORS restricted to localhost
- ✅ CSP headers + X-Frame-Options: DENY
- ✅ File permissions audited (600 on secrets, 700 on data dir)
- ✅ No `exec()` shell usage (argv-only `execFile`)
- ✅ Audit logging to `data/security-audit.jsonl`

### Known Gotchas
- **WhatsApp LID Resolution**: Desktop uses `@lid` JID format (linked-device ID), phone uses `@s.whatsapp.net`. Cache maps phone↔LID (5000 entry LRU).
- **Conversation Count Dedup**: Email dedup was broken (counted same message multiple times). Fixed 2026-02-18 by reading counts from LanceDB source filter.
- **KYC Analysis Chunking**: Max 8 chunks per sweep, max 400 messages sampled (configurable via env vars).
- **Gmail Counting**: `resultSizeEstimate` unreliable for mailbox totals; use `messagesTotal` from profile instead.
- **Template Literal Escaping**: In dashboard.js, `${}` inside backticks triggers immediate interpolation. Escape as `\${}` if meant for code string.

### Code Quality Standards
- ✅ JSDoc comments on all exported functions
- ✅ ES6 async/await (no callbacks except node callbacks)
- ✅ Error handling in background workers (catch → log → continue)
- ✅ Bounded caches (LRU, Set/Map caps) in long-running processes
- ✅ Strict mode on sensitive modules
- ✅ No globals (scoped vars, module exports)
- ✅ Tests: 26 passing (security-policy, rate-limiter, etc.)
- ✅ Lint: ESLint 9 with no warnings

---

## Operational Procedures

### Daily Standup (EOD)
```
{reply} Status — Sprint X, Week Y

✅ Completed:
- #XXX: [Brief] (commit SHA)

🟡 In Progress:
- #YYY: [Brief] — ETA [date]

🚨 Blockers:
- [list or "None"]

📊 Metrics:
- Tests: 26/26 ✅
- Velocity: X days
- On track: Yes/No
```

### Issue Lifecycle (Mandatory)
1. **Create** in `moldovancsaba/reply` and add to [Project #7](https://github.com/users/moldovancsaba/projects/7) (for `{reply}` work)
2. **Title format**: `{reply}: <short description>`
3. **Add to board** (Project 1) immediately
4. **Set fields**: Product=reply, Type, Priority, Status
5. **Assign owner** when moving to In Progress
6. **Verify board membership** before closing (use `gh project item-list` with `-L 500`)
7. **Document completion** in HANDOVER.md immediately
8. **NO LOCAL FILES**: Do NOT maintain a local `task.md` or similar file anywhere in the workspace. All tasks go directly to the GitHub Project Board.

### Triage Rules (Status Assignment)
- **IDEA BANK**: Speculative feature (no clear acceptance criteria, nice-to-have, unclear effort)
- **Backlog**: Accepted work, defined, blocked or waiting (no blocker constraints in issue description)
- **Ready**: Fully scoped, no blockers, can start immediately (team confirmed acceptance criteria)
- **In Progress**: Active development (assigned owner, daily updates)
- **Review**: Implemented, awaiting code review or testing (PR open or in UAT)
- **Done**: Verified, merged, board & HANDOVER.md updated

### Board Field Rules (Critical)
| Field | Reply-Specific Rule |
|-------|-------------------|
| **Product** | MUST be `reply` (not case-sensitive but consistent) |
| **Type** | Feature \| Bug \| Refactor \| Audit \| Docs \| Plan |
| **Priority** | P0 (blocker), P1 (high), P2 (normal) |
| **Status** | IDEA BANK \| Backlog \| Ready \| In Progress \| Review \| Done \| Roadmap |
| **Agent** | Agnes (primary), or TBD if unassigned |
| **DoD** | Passed (only when closing to Done) |

---

## Planning Documents (2026-02-22)

### Newly Created
1. **DEPENDENCY_MAP.md** — Shows blocking relationships between issues
   - Critical path: #212 → #213 → #211 → #223, #224, #221
   - Total 3-4 week timeline for all P1 work

2. **BACKLOG_PRIORITIZATION.md** — Scored ranking matrix
   - Score = (Impact × Dependencies) ÷ Effort
   - Highest scores: #212 (16), #213 (5.0), #223 (5.0)

3. **SPRINT_PLAN_2W.md** — Day-by-day execution plan
   - Sprint 1 (Week 1): Verify foundation, start #214, continue #197
   - Sprint 2 (Week 2): Execute #211 refactor, design #223, finish #214

### To Create (Identified)
- **Issue #225+**: Formal issues for all sprint tasks (if not already created)
- **Architecture Decision Record**: Document for #220 scope (LinkedIn send vs inbound-only)

---

## Recent Changes & Context (Last Session: 2026-02-22)

### What Was Done
1. ✅ Analyzed project board (64 {reply} issues across 6 statuses)
2. ✅ Created dependency map (critical path identified)
3. ✅ Prioritized backlog using ROI scoring
4. ✅ Planned 2-week sprint with day-by-day tasks
5. ✅ Identified verification blockers (#212, #213)

### What Needs Action
1. **Verify #212 (CI)**: `.github/workflows/ci.yml` exists?
2. **Verify #213 (SQL)**: No string-interpolated SQL?
3. **Mark #194 Done**: Message count fix is complete (verify counts match)
4. **Triage unspecified issues**: #171, #172, #173 need Status assignment
5. **Create formal issues for sprint tasks**: If not already on board

### Decisions Made
- **#211 must happen**: Critical for enabling all settings features (#223, #224, #221)
- **#214 start immediately**: Independent quick win, improves UX
- **#197 clarify blocker**: Determine if server-side filtering truly required for #221
- **#220 scope first**: LinkedIn send capabilities need architectural decision before dev

---

## Risk Registry

| Risk | Status | Mitigation |
|------|--------|-----------|
| #211 refactor breaks endpoints | Medium | Full test suite before/after; rollback branch ready |
| #212 CI not working | Low | Verify workflow exists; test locally first |
| #213 SQL audit incomplete | Low | Run grep twice; document all findings |
| #197 doesn't unblock #221 | Medium | Ask PO; document client-side decision early |
| #211 performance regression | Low | Benchmark before/after |
| Large monolithic server.js | HIGH | #211 refactor actively addresses this |

---

## Next Steps (Priority Order)

1. ✅ **Sprint Planning**: DONE (DEPENDENCY_MAP, BACKLOG_PRIORITIZATION, SPRINT_PLAN_2W created)
2. 🔴 **Create formal issues**: Convert sprint tasks to board issues (if not present)
3. 🔴 **Verify #212, #213**: Check CI workflow and SQL audit status
4. 🟡 **Triage unspecified issues**: Assign Status to #171, #172, #173
5. 🟡 **Start #214**: Quick UX win (independent, no blockers)
6. 🟡 **Continue #197**: Clarify blocker for #221

---

## Update Protocol

**This document syncs after:**
- Every issue completion (add summary + any new learnings)
- Weekly (Friday EOD standup)
- Any architectural decision made
- Any blocker discovered

**Sync checklist:**
- [ ] Board status matches this doc
- [ ] New completions logged
- [ ] New blockers/risks documented
- [ ] Next steps updated
- [ ] Commit: `docs: sync brain dump with current state`
