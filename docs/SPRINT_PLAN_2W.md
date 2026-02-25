# {reply} Sprint Plan: Next 2 Weeks

**Sprint Duration**: 2026-02-22 to 2026-03-07 (14 days)  
**Capacity**: 1 full-time AI Developer (estimated 10 working days)  
**Document Status**: Live Sprint Execution Plan  
**Owner**: AI Developer  
**Last Updated**: 2026-02-22

---

## Sprint Overview

**Sprint 1 & 2 Goals**:
- Verify foundation issues (#212, #213) are complete and working
- Continue in-progress work (#197 indexing)
- Ship quick-win UX improvements (#214 loading states)
- Prepare for major architecture refactor (#211)
- **No regressions**: All existing tests must pass throughout

---

## SPRINT 1 (Week 1: 2026-02-22 to 2026-02-28)

### Sprint 1 Goals
- Verify and close foundation issues (#212, #213)
- Continue #197 (understand blocker for #221)
- Start #214 (quick UX win, independent)
- Prepare infrastructure for #211 (create branching strategy)

---

### Issue 1: #212 CI Pipeline — Verification & Ship

**Status**: Board says "Done" — **UNVERIFIED**  
**Assigned To**: AI Developer  
**Effort**: 2-4 hours  
**Start Date**: 2026-02-22 (Monday)  
**Target Completion**: 2026-02-22 (same day)

**Tasks**:
- [ ] **Task 1.1**: Check if `.github/workflows/ci.yml` exists
  ```bash
  ls -la /Users/moldovancsaba/Projects/reply/.github/workflows/ci.yml
  ```
  - If NOT found → proceed to Task 1.2
  - If found → skip to Task 1.3

- [ ] **Task 1.2** (if needed): Create GitHub Actions workflow
  - File: `.github/workflows/ci.yml`
  - Content: Run `npm lint` on all pushes + PRs
  - Content: Run `npm test` on all pushes + PRs
  - Timeout: 5 minutes max
  - Save file and commit: `"chore: add GitHub Actions CI workflow"`

- [ ] **Task 1.3**: Run tests locally
  ```bash
  npm test
  ```
  - Expected: 26 tests pass ✅
  - If any fail: Fix before proceeding

- [ ] **Task 1.4**: Verify GitHub Actions runs
  - Push test commit to feature branch
  - Verify: Workflow executes in GitHub UI
  - Check: All checks pass (lint + test)
  - Merge to main

- [ ] **Task 1.5**: Update board
  - Mark #212 as "Done"
  - Add comment with commit SHA
  - Link to workflow runs

**Definition of Done**:
- ✅ `.github/workflows/ci.yml` exists and is executable
- ✅ `npm test` passes all 26 tests
- ✅ `npm run lint` passes without warnings
- ✅ Workflow completes in <5 minutes
- ✅ GitHub Actions runs on push/PR
- ✅ README has CI badge (optional but nice)

**Success Criteria**:
- Badge shows green checkmark on repo main branch
- All PRs show CI status (Pass/Fail)
- Zero post-merge surprises (tests fail after landing)

---

### Issue 2: #213 SQL Security Audit — Audit & Fix

**Status**: Board says "Done" — **UNVERIFIED**  
**Assigned To**: AI Developer  
**Effort**: 4-8 hours  
**Start Date**: 2026-02-22 (Monday) — **parallel with #212**  
**Target Completion**: 2026-02-23 (Tuesday)

**Tasks**:
- [ ] **Task 2.1**: Audit for string-interpolated SQL
  ```bash
  grep -r "WHERE.*\${" /Users/moldovancsaba/Projects/reply/chat/*.js | grep -v "//"
  ```
  - If results found → Document each finding with line number
  - If no results → Proceed to Task 2.3

- [ ] **Task 2.2** (if findings): Fix vulnerable queries
  - For each finding:
    - Replace string interpolation with parameterized query
    - Example:
      ```javascript
      // ❌ BEFORE (unsafe)
      const sql = `SELECT * FROM contacts WHERE id = '${id}'`;
      db.run(sql, callback);
      
      // ✅ AFTER (safe)
      db.run("SELECT * FROM contacts WHERE id = ?", [id], callback);
      ```
    - Run `npm test` after each fix to verify no breakage
    - Commit each fix: `"fix: parameterize SQL query for <table>"`

- [ ] **Task 2.3**: Re-audit (confirm fix)
  ```bash
  grep -r "WHERE.*\${" /Users/moldovancsaba/Projects/reply/chat/*.js | grep -v "//"
  ```
  - Expected output: Empty (no findings)
  - If findings remain: Repeat Task 2.2

- [ ] **Task 2.4**: Document audit results
  - Comment on issue #213:
    - Audit date: [date]
    - Queries scanned: [count]
    - Findings: [count] (0 if clean)
    - Fixes applied: [list if any]
    - Re-audit result: ✅ CLEAN

- [ ] **Task 2.5**: Update board
  - Mark #213 as "Done"
  - Link to audit comment
  - Confirm: All tests pass after fixes

**Definition of Done**:
- ✅ No string-interpolated SQL in `chat/*.js`
- ✅ All DB calls use parameterized queries
- ✅ `npm test` passes 100% (all 26 tests)
- ✅ Audit results documented
- ✅ Zero security warnings from audit

**Success Criteria**:
- Audit passes cleanly (zero findings)
- All tests still pass (no regression)
- Code review approved (if applicable)

---

### Issue 3: #197 Conversation Indexing — Continue WIP

**Status**: In Progress  
**Assigned To**: Inherited  
**Effort**: 2-3 days  
**Timeline**: 2026-02-23 to 2026-02-27 (finish by Friday)  
**Current Blocker**: Unclear if server-side filtering is required for #221

**Tasks**:
- [ ] **Task 3.1**: Understand current state
  - Check git branches: `git branch -a | grep -i index`
  - Review PR (if open): Read description, comments, code
  - Run locally: `npm test` — should pass
  - Check for open issues or TODOs in code

- [ ] **Task 3.2**: Answer critical question
  - **Question**: Does server-side `q=` filter truly block #221 (Settings Hub)?
  - Check #221 issue description for dependencies
  - If answer is "yes" → continue with server-side implementation
  - If answer is "no" → document client-side fallback is acceptable
  - Add comment to #197 with decision

- [ ] **Task 3.3** (if server-side needed): Implement server-side filtering
  - Add `?q=<search_term>` parameter to `GET /api/conversations`
  - Filter contacts by name match in results
  - Cache strategy: Still use 60s TTL for stats
  - Test locally: `npm test` (new tests should be added)
  - Commit: `"feat: add server-side conversation search (#197)"`

- [ ] **Task 3.4** (if client-side OK): Document decision
  - Add comment to #197 explaining why client-side is acceptable
  - Link to architectural decision (create doc if needed)
  - Commit: `"docs: record client-side search decision for #197"`

- [ ] **Task 3.5**: Verify conversation counts
  - Test: Sidebar count = Dashboard count = Thread view count
  - No off-by-one errors after dedup
  - Run: `npm test` (all 26 tests pass)

- [ ] **Task 3.6**: Finalize and merge
  - Code review (if applicable)
  - Merge PR to main
  - Update board: Mark #197 as "In Review" or "Done"

**Definition of Done**:
- ✅ Either: Server-side filtering works + tests pass
- ✅ Or: Documented decision to use client-side filtering
- ✅ Conversation counts match across all views
- ✅ `npm test` passes 100%
- ✅ No regression in search UX

**Success Criteria**:
- `/api/conversations?q=john` returns filtered results (if server-side)
- OR client-side filtering proven sufficient for #221 (if no server-side)
- All conversation count views consistent (0 errors)

---

### Issue 4: #214 Loading States + Error Toasts — START

**Status**: Backlog → In Progress  
**Assigned To**: AI Developer  
**Effort**: 1-2 days (can start immediately, no blockers)  
**Timeline**: 2026-02-24 to 2026-02-28 (overlap with #211 prep)  
**Can Parallelize**: Yes (independent of other work)

**Tasks**:
- [ ] **Task 4.1**: Create Spinner component
  - File: `chat/js/components/Spinner.js`
  - Export: `class Spinner extends HTMLElement { ... }`
  - Styling: Simple CSS spinner animation
  - Delay: Don't show if request completes in <100ms (avoid flicker)
  - Template:
    ```html
    <div class="spinner-overlay">
      <div class="spinner"></div>
    </div>
    ```

- [ ] **Task 4.2**: Create Toast component
  - File: `chat/js/components/Toast.js`
  - Variants: success (green), error (red), timeout (yellow)
  - Auto-dismiss: 3-5 seconds (except persistent on error)
  - Position: Bottom-right corner
  - Stack: Multiple toasts can show at once
  - Accessibility: ARIA roles, keyboard dismissible

- [ ] **Task 4.3**: Hook Spinner into async endpoints
  - Endpoints to update:
    - `POST /api/send-imessage` → show spinner
    - `POST /api/send-whatsapp` → show spinner
    - `POST /api/send-email` → show spinner
    - `POST /api/send-linkedin` → show spinner
    - `POST /api/sync-imessage` → show spinner
    - `POST /api/sync-whatsapp` → show spinner
    - `POST /api/sync-mail` → show spinner
    - `POST /api/kyc-analyze` → show spinner
  - Implementation: Wrap fetch calls with spinner logic
  - Hide spinner: On success, error, or timeout (>30s)

- [ ] **Task 4.4**: Hook Toast into error responses
  - Show error toast for: 4xx errors, 5xx errors
  - Toast content: Show error message from response
  - Example: `{error: "Rate limit exceeded"}` → Toast: "Error: Rate limit exceeded"
  - Persistent: Don't auto-dismiss errors
  - Dismiss button: Always available (X icon)

- [ ] **Task 4.5**: Test locally
  - Browser DevTools → Network tab → Slow 3G
  - Verify spinner appears within 100ms
  - Verify spinner hides on success
  - Trigger error: Disconnect network → verify error toast shows
  - Test multiple toasts: Trigger 3 errors at once → verify they stack

- [ ] **Task 4.6**: Cross-browser testing
  - Chrome: ✅ Test
  - Firefox: ✅ Test
  - Safari: ✅ Test
  - Edge: ✅ Test
  - Verify: No console errors, animations smooth

- [ ] **Task 4.7**: Finalize and merge
  - Code review (if applicable)
  - Commit: `"feat: add loading states and error toasts (#214)"`
  - Merge to main (can be before end of sprint if ready)

**Definition of Done**:
- ✅ Spinner component shows on all async endpoints
- ✅ Spinner disappears after response (success/error/timeout)
- ✅ Error toast shows for all failed requests
- ✅ Toast auto-dismisses on success (3-5s)
- ✅ Toast persistent on error (user must dismiss)
- ✅ Works on Chrome, Firefox, Safari, Edge
- ✅ `npm test` passes (no regression)
- ✅ No console errors or warnings

**Success Criteria**:
- Loading indicator appears within 100ms of button click
- Error toast appears for all 4xx/5xx responses
- UX feels snappier (perceived performance improvement)
- All browsers render correctly

---

### Sprint 1 Summary

| Issue | Status | Effort | Days | Est. Complete |
|-------|--------|--------|------|----------------|
| #212  | Verify/Ship | 2-4h | 0.5 | 2026-02-22 |
| #213  | Audit/Fix | 4-8h | 0.5-1 | 2026-02-23 |
| #197  | Continue WIP | 2-3d | 2-3 | 2026-02-27 |
| #214  | Start | 1-2d | 1-2 | 2026-02-28 |
| **Total** | - | - | **4-6 days** | - |

**Remaining Capacity**: 4-6 days (buffer for blockers or #211 prep)

---

## SPRINT 2 (Week 2: 2026-03-01 to 2026-03-07)

### Sprint 2 Goals
- Verify foundation (#212, #213) is solid
- **Execute major refactor #211** (decompose server.js)
- Finish #214 (loading states)
- Design and spec #223 (AI provider cards)
- Maintain zero regressions

---

### Issue 5: #211 Decompose server.js — MAIN WORK

**Status**: Backlog → In Progress  
**Assigned To**: AI Developer  
**Effort**: 3-4 days  
**Timeline**: 2026-03-01 to 2026-03-06 (4 working days)  
**Target Completion**: 2026-03-06 (Tuesday)

**Prerequisites**:
- ✅ #212 (CI working)
- ✅ #213 (SQL audit clean)
- ✅ Rollback branch created (safety)

**Pre-Refactor Checklist**:
- [ ] Create rollback branch: `git checkout -b rollback-211-before`
- [ ] Verify `npm test` passes (all 26 tests) — baseline
- [ ] Verify `npm run lint` passes — baseline
- [ ] Document current API endpoints (copy from server.js top comment)
- [ ] Create feature branch: `git checkout -b feat/211-decompose-server`

**Roadmap** (4 days):

**Day 1 (Thu 2026-03-01): Prepare Directory Structure**
- [ ] Create `chat/routes/` directory
- [ ] Create `chat/middleware/` directory
- [ ] Move `chat/kyc.js` → `chat/routes/kyc.js` (already extracted)
- [ ] Verify no import breakage: `npm test` (should still pass)
- [ ] Commit: `"chore: prepare routes directory structure"`

**Day 2 (Fri 2026-03-02): Extract Send & Sync Routes**
- [ ] Create `chat/routes/send.js`
  - Move routes: POST /api/send-imessage, /send-whatsapp, /send-email, /send-linkedin
  - Move helpers: whatsAppIdResolver, sendAppleScript, sendDesktopWhatsApp, etc.
  - Test locally: Each send endpoint returns correct response
  
- [ ] Create `chat/routes/sync.js`
  - Move routes: POST /api/sync-imessage, /sync-whatsapp, /sync-mail, /sync-notes
  - Move helpers: iMessageSync, WhatsAppSync, GmailSync, etc.
  - Test locally: Each sync endpoint returns correct response

- [ ] Update `chat/server.js`:
  - Remove old route code (replace with `const sendRoutes = require('./routes/send');`)
  - Wire routes: `app.use(sendRoutes); app.use(syncRoutes);`
  
- [ ] Verify: `npm test` passes (all 26 tests)
- [ ] Commit: `"refactor: extract send and sync routes"`

**Day 3 (Mon 2026-03-05): Extract Settings & Conversations Routes**
- [ ] Create `chat/routes/settings.js`
  - Move routes: GET /api/settings, POST /api/settings/{field}, POST /api/auth/gmail
  - Move helpers: Settings load/save functions
  - Test locally: Settings endpoints work
  
- [ ] Create `chat/routes/conversations.js`
  - Move routes: GET /api/conversations, GET /api/thread/:contactId, GET /api/system-health
  - Move helpers: Conversation list building, thread loading, stat calculation
  - Test locally: Conversation endpoints work

- [ ] Update `chat/server.js`:
  - Wire new routes: `app.use(settingsRoutes); app.use(conversationRoutes);`
  
- [ ] Verify: `npm test` passes (all 26 tests)
- [ ] Commit: `"refactor: extract settings and conversations routes"`

**Day 4 (Tue 2026-03-06): Extract Bridge & Health Routes, Cleanup Middleware**
- [ ] Create `chat/routes/bridge.js`
  - Move routes: POST /api/bridge/ingest, POST /api/bridge/summary
  - Move helpers: Channel normalization
  
- [ ] Create `chat/routes/health.js`
  - Move routes: GET /api/system-health, GET /api/worker-status
  - Move helpers: Health check logic
  
- [ ] Create shared middleware files:
  - `chat/middleware/auth.js`: authorizeSensitiveRoute, hasValidOperatorToken
  - `chat/middleware/security.js`: CORS, CSP, rate limiting, audit logging
  - `chat/middleware/static.js`: Serve HTML/CSS/JS/public
  
- [ ] Update `chat/server.js`:
  - Wire all middleware: `app.use(securityMiddleware); app.use(authMiddleware);`
  - Wire all routes: `app.use(bridgeRoutes); app.use(healthRoutes);`
  - Clean up: Remove old route code, old middleware code
  - Verify: Only route registration + middleware registration remains (~200 lines)
  
- [ ] Full system test:
  ```bash
  npm test    # All 26 tests pass
  npm run lint # Zero warnings
  npm start   # Server starts on port 3000
  ```
  - Manual test: Hit http://localhost:3000 → app loads ✅
  - Manual test: Send a message → works ✅
  - Manual test: Sync a channel → works ✅
  
- [ ] Verify: `npm test` passes (all 26 tests)
- [ ] Verify: `npm run lint` passes
- [ ] Commit: `"refactor: complete server decomposition (#211)"`

**Post-Refactor Verification**:
- [ ] Run full test suite again: `npm test` (expect: 26/26 pass)
- [ ] Check performance: no observable slowdown
- [ ] Test on port 3000: All UI features work
- [ ] Check imports: `npm audit` (expect: 0 vulnerabilities)
- [ ] Cleanup: Delete rollback branch (or keep for 1 week, then delete)

**Definition of Done**:
- ✅ All routes in `chat/routes/*.js` (7 files)
- ✅ All middleware in `chat/middleware/*.js` (3 files)
- ✅ `chat/server.js` reduced to ~200 lines (clean registry)
- ✅ All imports working (no 404s, no circular deps)
- ✅ `npm test` passes 100% (26/26 tests)
- ✅ `npm run lint` passes without warnings
- ✅ No performance regression
- ✅ All endpoints respond correctly
- ✅ Zero console errors in browser

**Success Criteria**:
- Every endpoint (`GET /api/conversations`, `POST /api/send-whatsapp`, etc.) returns correct HTTP status
- UI renders without errors
- No visual regressions (UI looks identical to before)
- Background worker still runs (KYC analysis, proactive drafts)
- Message history loads and displays correctly

**Risk Mitigation**:
- **Rollback plan**: If major issues, revert to `rollback-211-before` branch and debug
- **Per-day verification**: Test after each day's work
- **Commit frequently**: Atomic commits (one route per commit) make debugging easier
- **Keep browser console open**: Watch for errors as you refactor

---

### Issue 6: #223 AI Provider Cards — DESIGN & SPEC

**Status**: Backlog → Ready (planning phase)  
**Assigned To**: AI Developer  
**Effort**: 4-8 hours  
**Timeline**: 2026-03-04 to 2026-03-07 (can start mid-week)  
**Target**: Complete by end of Sprint 2

**Tasks**:
- [ ] **Task 6.1**: Design UI mockup
  - Tool: Figma or ASCII sketch (either fine)
  - Show: Two provider cards (Ollama local, OpenClaw remote)
  - Include: Status indicator, health check button, config inputs
  - Save: Sketch or screenshot in issue #223

- [ ] **Task 6.2**: Spec API endpoints
  - Endpoint 1: `GET /api/ai-providers` — list available providers
  - Endpoint 2: `GET /api/ai-health` — current provider status
  - Endpoint 3: `POST /api/ai-config` — update provider settings
  - Document: Request/response shapes (JSON examples)

- [ ] **Task 6.3**: Write detailed acceptance criteria
  - Card shows: Provider name, status (✅/❌), latency, error count
  - Card controls: Toggle between providers, config inputs, health check button
  - Behavior: Health check pings provider, tests inference, shows result
  - Edge cases: Offline provider, bad API key, wrong URL, timeout

- [ ] **Task 6.4**: Estimate implementation effort
  - Frontend: 2-3 days (UI component + API calls)
  - Backend: 1-2 days (health check endpoints)
  - Total: 3-4 days (expected delivery in Sprint 3)

- [ ] **Task 6.5**: Update issue #223
  - Add comment: "Design complete"
  - Link to mockup
  - Paste acceptance criteria
  - Update board: Mark as "Ready" (for Sprint 3)

**Definition of Done**:
- ✅ Mockup created and attached to issue
- ✅ API spec documented with examples
- ✅ Acceptance criteria detailed and unambiguous
- ✅ Effort estimated (3-4 days)
- ✅ Issue marked "Ready" on board
- ✅ Ready for implementation in Sprint 3

**Success Criteria**:
- Mockup clearly shows both provider cards
- API spec includes all necessary endpoints
- Acceptance criteria are testable (not vague)
- Implementation estimate is agreed upon

---

### Issue 7: #214 Loading States — FINISH

**Status**: In Progress → Done  
**Assigned To**: AI Developer  
**Effort**: 4-8 hours (remaining)  
**Timeline**: 2026-03-03 to 2026-03-04 (finish early in week)

**Tasks**:
- [ ] **Task 7.1**: Polish animation timing
  - Spinner: 100-200ms delay (avoid flicker on fast responses)
  - Animation: Smooth, ~2 second rotation
  - Toast: 3-5 second auto-dismiss (configurable)

- [ ] **Task 7.2**: Test on slow network
  - Chrome DevTools → Network → Slow 3G
  - Verify: Spinner visible for >1 second
  - Verify: Toast shows and dismisses correctly

- [ ] **Task 7.3**: Test error handling
  - Trigger timeout: Kill network → verify timeout toast shows
  - Trigger 4xx: Bad request → verify error toast
  - Trigger 5xx: Server error → verify error toast

- [ ] **Task 7.4**: Test cross-browser
  - Chrome ✅, Firefox ✅, Safari ✅, Edge ✅
  - Verify: Animations smooth on all browsers
  - Verify: No console errors

- [ ] **Task 7.5**: Final merge and close
  - Merge PR to main
  - Update board: Mark #214 as "Done"
  - Add comment: "Shipped — Spinner + error toast on all async endpoints"

**Definition of Done**:
- ✅ Spinner + toast fully functional
- ✅ Works on Chrome, Firefox, Safari, Edge
- ✅ No console errors or warnings
- ✅ `npm test` passes (no regression)
- ✅ Merged to main
- ✅ Board updated

---

### Sprint 2 Summary

| Issue | Status | Effort | Days | Est. Complete |
|-------|--------|--------|------|----------------|
| #211  | In Progress | 3-4d | 3-4 | 2026-03-06 |
| #223  | Design/Spec | 0.5-1d | 0.5-1 | 2026-03-07 |
| #214  | Finish | 0.5d | 0.5 | 2026-03-04 |
| **Total** | - | - | **4-5.5 days** | - |

**Remaining Capacity**: 4.5-5 days (buffer for #211 blockers or prep #224)

---

## Post-Sprint Planning (Future)

### Sprint 3 (Week 3: 2026-03-08 to 2026-03-14)
1. **#223: AI Provider Cards** — Full implementation (3-4 days)
2. **#224: Per-Channel Settings Matrix** — Design & spec (1 day)
3. Buffer for blockers

### Sprint 4 (Week 4: 2026-03-15 to 2026-03-21)
1. **#224: Per-Channel Settings Matrix** — Implementation (2-3 days)
2. **#221: Settings IA Hub** — Implementation (1-2 days)
3. **#220: LinkedIn Enablement** — Scoping & implementation (1-2 days)

---

## Definitions

### Definition of Done (per issue)
- ✅ Acceptance criteria met (all pass)
- ✅ Code review approved
- ✅ All tests pass (`npm test` → 26/26)
- ✅ Lint passes (`npm run lint` → 0 warnings)
- ✅ No security issues (`npm audit` → 0 vulnerabilities)
- ✅ Merged to main branch
- ✅ Board updated (status = Done, link to commit)
- ✅ Documentation updated (if applicable)

### Definition of Ready (before starting)
- ✅ Issue has clear acceptance criteria
- ✅ Effort estimated and agreed
- ✅ Dependencies identified (blockers listed)
- ✅ Not blocked by other issues
- ✅ Assigned to specific person/agent

---

## Metrics & Tracking

### Sprint Velocity
- **Sprint 1 Planned**: 4-6 days effort
- **Sprint 2 Planned**: 4-5.5 days effort
- **Total 2-week capacity**: 8.5-11.5 days (good for 1 FTE agent)

### Success Criteria
- ✅ All foundation issues (#212, #213) verified and closed
- ✅ #211 (major refactor) 100% complete, all tests passing
- ✅ #214 (UX polish) shipped
- ✅ #223 (AI config) designed and spec'd, ready for implementation
- ✅ Zero regressions (existing tests all pass)
- ✅ Test coverage maintained >80%

### Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| #211 refactor breaks endpoints | Medium | High | Full test suite before/after; rollback branch ready |
| #212 CI not working | Low | High | Test locally first; use GitHub Actions docs |
| #213 SQL audit incomplete | Low | High | Run audit twice; document all findings |
| #197 blocker unclear | Medium | Medium | Ask PO; document decision early |
| #211 regression (performance) | Low | Medium | Benchmark before/after; compare metrics |
| Network issues during #211 | Low | Low | Small commits; frequent pushes |

---

## Handoff Notes (for next agent)

**If handoff occurs before end of Sprint 1 (2026-02-28)**:
- [ ] Verify #212 CI working (test suite runs on GitHub)
- [ ] Verify #213 SQL audit complete (audit comment posted)
- [ ] Document #197 blocker status (is server-side required for #221?)
- [ ] #214 should be 70%+ done (spinners + toasts working locally)
- [ ] Create rollback branch for #211 before starting Sprint 2

**If handoff occurs before end of Sprint 2 (2026-03-07)**:
- [ ] #211 refactor should be 50%+ complete (routes/ directory populated)
- [ ] All tests passing throughout refactor
- [ ] #223 design & spec should be 80%+ done (mockup + API spec drafted)
- [ ] #214 should be shipped (merged to main, board updated)
- [ ] Any blockers documented with suggested mitigations

**Quick Sync Template** (Friday EOD):
```
{reply} Sprint Status — Sprint X, Week Y

✅ Completed (this week):
- #XXX: [Brief description] (commit SHA: abc123)

🟡 In Progress (ETA):
- #YYY: [Brief description] — ETA [date]
- #ZZZ: [Brief description] — ETA [date]

🚨 Blockers:
- None / [list blockers with mitigation]

📊 Metrics:
- Velocity: X days completed
- Tests passing: 26/26 ✅
- On track: Yes/No
- Risks: [any new risks?]
```

---

## Update Protocol

**This document must be refreshed:**
- ✅ Daily (quick sync of status)
- ✅ Every sprint completion (update next sprint details)
- ✅ When issue scope changes significantly
- ✅ When effort estimate changes >20%

**Sync checklist**:
- [ ] Verify board status matches this document
- [ ] Update issue status
- [ ] Update effort/days if changed
- [ ] Update any blockers discovered
- [ ] Commit with message: `docs: sync sprint plan with board (SPRINT_X_DAY_Y)`

**Next scheduled update**: Daily (EOD) and 2026-02-28 (end of Sprint 1)
