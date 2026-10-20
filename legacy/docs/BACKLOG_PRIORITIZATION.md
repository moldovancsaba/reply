# {reply} Backlog Prioritization Matrix

**Document Status**: Live Planning Document  
**Last Updated**: 2026-02-22  
**Owner**: AI Developer  
**Sync Requirement**: Update after sprint completion or major scope change

---

## Scoring Methodology

**Score Formula**: (Impact × Dependencies) ÷ Effort

Where:
- **Impact** (1-5): How much does it improve user experience or reduce risk?
- **Effort** (1-5): Person-days to complete? (1=quick, 5=long)
- **Dependencies** (count): How many other issues depend on this?
- **Risk** (1-5): What breaks if we skip this? (1=none, 5=critical)

**Higher score = better ROI (prioritize first)**

---

## PRIORITY RANKING

### 🔴 URGENT (Foundation — Must do first)

#### #212: CI Pipeline (GitHub Actions lint + test)
- **Board Status**: Done (unverified)
- **Impact**: 4/5 (unblocks safe refactoring)
- **Effort**: 1/5 (quick if not already done)
- **Dependencies**: 4 (blocks #211, #219, indirectly #214)
- **Risk**: 4/5 (can't safely refactor without tests)
- **Score**: (4 × 4) ÷ 1 = **16** ✅ **HIGHEST PRIORITY**
- **Estimate**: 2-4 hours (verification + fix if needed)
- **Success Criteria**:
  - `.github/workflows/ci.yml` exists and is executable
  - `npm test` passes all 26 tests in CI
  - Workflow completes in <5 minutes
  - Badge displays ✅ on README
  - PRs show CI status checks

**Action Items**:
- [ ] Verify workflow file exists
- [ ] If not: Create `.github/workflows/ci.yml` for `npm lint` + `npm test`
- [ ] Test locally: `npm test` should pass 100%
- [ ] Push to branch; verify GitHub Actions runs
- [ ] Update README with CI badge

---

#### #213: Parameterized SQL (security audit)
- **Board Status**: Done (unverified)
- **Impact**: 5/5 (security critical — SQL injection = RCE)
- **Effort**: 2/5 (audit + targeted fixes)
- **Dependencies**: 2 (blocks #201 secure memory index)
- **Risk**: 5/5 (SQL injection vulnerability)
- **Score**: (5 × 2) ÷ 2 = **5.0** ✅ **CRITICAL SECURITY**
- **Estimate**: 4-8 hours (audit + fixes)
- **Success Criteria**:
  - No string-interpolated SQL in `chat/*.js`
  - All DB calls use parameterized queries
  - Audit results documented in issue
  - Zero findings (or all findings fixed and logged)

**Action Items**:
- [ ] Audit: `grep -r "WHERE.*\${" chat/*.js | grep -v "//"`
- [ ] Document any findings in issue comment
- [ ] Fix vulnerable queries (replace with parameterized)
- [ ] Re-audit: confirm zero findings
- [ ] Test fixes: `npm test` passes, no side effects
- [ ] Mark issue as Done with audit results

**Vulnerable Pattern Example** (do NOT use):
```javascript
const sql = `SELECT * FROM contacts WHERE handle = '${handle}'`; // ❌ UNSAFE
```

**Safe Pattern** (use instead):
```javascript
db.all("SELECT * FROM contacts WHERE handle = ?", [handle], callback); // ✅ SAFE
```

---

#### #197: Conversation Indexing Cleanup
- **Board Status**: In Progress
- **Impact**: 3/5 (better search/sort UX)
- **Effort**: 3/5 (server-side filtering + caching)
- **Dependencies**: 2 (blocks #221 settings hub, #202 indirectly)
- **Risk**: 2/5 (performance degradation if wrong)
- **Score**: (3 × 2) ÷ 3 = **2.0** ⚠️ **CONTINUE WIP**
- **Estimate**: 2-3 days (finish by end of Sprint 1)
- **Critical Question**: Does server-side `q=` filter truly block #221?

**Action Items**:
- [ ] Clarify blocker status (ask: is server-side filtering required for #221?)
- [ ] If yes: Implement server-side search filtering (1-2 days)
- [ ] If no: Document why client-side fallback is acceptable
- [ ] Verify: Conversation counts match across sidebar, dashboard, thread view
- [ ] Test: No off-by-one count errors
- [ ] Merge PR when complete; update board

**Acceptance Criteria**:
- `GET /api/conversations?q=<search_term>` returns filtered results
- Server-side filtering or documented client-side fallback decision
- All conversation count views show consistent numbers

---

### 🟠 HIGH PRIORITY (Next 2 weeks)

#### #211: Decompose server.js into route modules
- **Board Status**: Backlog
- **Impact**: 4/5 (maintainability, unblocks new features)
- **Effort**: 5/5 (2-3 days, large refactor)
- **Dependencies**: 5 (blocks #214, #220, #221, #223, #224)
- **Risk**: 3/5 (regression risk if not tested)
- **Score**: (4 × 5) ÷ 5 = **4.0** 🚀 **START AFTER #212 + #213**
- **Estimate**: 3-4 days
- **Prerequisites**: #212 ✅, #213 ✅ (need tests + safe SQL)

**Proposed Structure**:
```
chat/routes/
├── kyc.js ✅ (already extracted)
├── send.js (iMessage, WhatsApp, Email, LinkedIn)
├── sync.js (ingest, mail, whatsapp, notes)
├── settings.js (config, auth, preferences)
├── conversations.js (list, thread, stats)
├── health.js (system status, worker status)
└── bridge.js (channel-bridge inbound, summary)

chat/middleware/
├── auth.js (operator token, security gates)
├── security.js (CORS, CSP, rate limiting, audit logging)
└── static.js (serve HTML/CSS/JS/public)
```

**Success Criteria**:
- `npm test` passes 100% (26 tests)
- `npm run lint` passes without warnings
- HTTP 200 on all send/sync/settings endpoints
- No visual regression (UI unchanged)
- Performance no worse than original

**Risk Mitigation**:
- Create rollback branch before starting: `git checkout -b rollback-211-before`
- Test each route individually after extraction
- Run `npm audit` to verify no missing dependencies
- Test on deployed port 3000 before final push

**Implementation Roadmap**:
- Day 1: Create routes/ structure, move kyc.js, test
- Day 2: Extract send.js + sync.js, verify imports
- Day 3: Extract settings.js + conversations.js, test
- Day 4: Extract bridge.js + health.js, cleanup middleware, full test suite

---

#### #223: AI Provider Cards (Ollama/OpenClaw health, config, selector)
- **Board Status**: Backlog
- **Impact**: 5/5 (production health visibility)
- **Effort**: 3/5 (UI + API backend)
- **Dependencies**: 3 (blocks #221, #224, #215)
- **Risk**: 3/5 (bad config can break LLM features)
- **Score**: (5 × 3) ÷ 3 = **5.0** 🎯 **HIGH-VALUE FEATURE**
- **Estimate**: 2-3 days (after #211)
- **Depends On**: #211 (clean routes for settings API)

**Feature Specification**:
```
Card 1: Ollama (local)
├── Model name selector
├── Status indicator (✅ Running / ❌ Offline)
├── Latency indicator (ms)
├── Error count (last 24h)
├── Base URL config input
└── Health check button (Ping → test inference)

Card 2: OpenClaw (remote)
├── Status indicator (✅ Connected / ❌ Offline)
├── API key config (masked input)
├── Model selector (dropdown)
├── Latency indicator (ms)
├── Error count (last 24h)
└── Health check button
```

**Success Criteria**:
- Card shows correct provider status (live health checks)
- Config changes persist across restarts
- Switch between Ollama/OpenClaw works without app restart
- Health check validates connectivity + inference capability
- All edge cases handled (offline, bad key, wrong URL, timeout)

---

#### #214: Loading States + Error Toast Notifications
- **Board Status**: Backlog
- **Impact**: 3/5 (perceived performance)
- **Effort**: 2/5 (can start now, independent)
- **Dependencies**: 0 (no blockers)
- **Risk**: 1/5 (low, UI only)
- **Score**: (3 × 0) + 3 ÷ 2 = **4.5** ✨ **QUICK WIN**
- **Estimate**: 1-2 days
- **Can Start**: Immediately (no dependencies) — **run in parallel with #211**

**Feature Specification**:
```
Spinner component:
├── Show on: POST /api/send-*, POST /api/sync-*, POST /api/kyc-analyze
├── Delay: Appear after 100ms (avoid flicker on fast responses)
├── Animation: Smooth CSS spinner or animated SVG
└── Overlay: Subtle (semi-transparent, doesn't block UI)

Toast notifications:
├── Success toast: Green, "Message sent ✓", auto-dismiss 3s
├── Error toast: Red, show error message, persistent until dismissed
├── Timeout toast: Yellow, "Request took too long", retry button
├── Position: Bottom-right corner, stack multiple
└── Accessibility: ARIA roles, keyboard dismissible
```

**Success Criteria**:
- Loading indicator appears within 100ms of button click
- Spinner visible during entire async operation
- Error toast appears for all 4xx/5xx responses
- Toast auto-dismisses (success/timeout after 3-5s)
- Works on Chrome, Firefox, Safari, Edge
- No console errors or warnings

---

### 🟡 MEDIUM PRIORITY (Weeks 3-4)

#### #224: Per-Channel Settings Matrix
- **Board Status**: Backlog
- **Impact**: 4/5 (fine-grained control)
- **Effort**: 3/5 (UI matrix + per-channel API)
- **Dependencies**: 2 (#211, #223)
- **Risk**: 2/5 (could break channel selection)
- **Score**: (4 × 2) ÷ 3 = **2.67** 🎛️ **MEDIUM-VALUE**
- **Estimate**: 2-3 days (after #211, #223)
- **Depends On**: #211 (channel routes), #223 (provider config)

**Feature Specification**:
```
Settings Matrix:
Rows:     iMessage | WhatsApp | Email | LinkedIn | Telegram | Discord | Signal | Viber
Columns:  Enabled | Sync Interval | Inbound Only | Send Via | Retry Policy | Last Sync

Example row (WhatsApp):
├── Enabled: Toggle (on/off)
├── Sync Interval: Dropdown (5m, 30m, 1h, 4h, 24h)
├── Inbound Only: Toggle (if true, no outbound send)
├── Send Via: Dropdown (Desktop Automation, OpenClaw CLI, Bridge)
├── Retry Policy: Dropdown (None, 3x, 5x exponential)
└── Last Sync: Timestamp (read-only)
```

---

#### #221: Settings IA Card Hub (consolidation)
- **Board Status**: Backlog
- **Impact**: 3/5 (better UX navigation)
- **Effort**: 2/5 (UI layout + routing)
- **Dependencies**: 2 (#223, #224)
- **Risk**: 1/5 (UI only)
- **Score**: (3 × 2) ÷ 2 = **3.0** 🏠 **INTEGRATOR**
- **Estimate**: 1-2 days (after #223, #224)

**Feature Specification**:
```
Settings Hub (4-column card layout):
1. AI Providers (#223)
   ├── Ollama card
   └── OpenClaw card

2. Channel Matrix (#224)
   └── Full matrix (see #224 spec)

3. Services
   ├── Gmail authentication
   ├── Ollama URL config
   └── Bridge sidecar status

4. Agents & Permissions
   ├── Operator token (if enabled)
   ├── Approval policy
   └── Rate limiting controls
```

---

#### #220: LinkedIn Channel Enablement
- **Board Status**: Backlog
- **Impact**: 3/5 (new channel)
- **Effort**: 3/5 (channel abstraction + guards)
- **Dependencies**: 2 (#211, scoping)
- **Risk**: 2/5 (API limitations)
- **Score**: (3 × 2) ÷ 3 = **2.0** 🔗 **SCOPE FIRST**
- **Estimate**: 2-3 days
- **⚠️ CRITICAL BLOCKER**: Scope must be clarified before starting

**Scoping Questions**:
- Is LinkedIn inbound-only or does send work?
- Does LinkedIn API allow DM send? (Answer: No public API)
- Fallback: Clipboard paste + browser open (current workaround)?
- What is the minimum viable feature for this issue?

**Action Required**:
- [ ] Update issue #220 description with scope decision
- [ ] Link to architecture decision doc (if created)
- [ ] Mark as "Ready" once scoped

---

### 🟢 LOW PRIORITY (Backlog, defer)

#### #215: First-run Onboarding Wizard
- **Board Status**: Backlog
- **Score**: 1.5 (low ROI)
- **Estimate**: 3-4 days
- **Defer**: Nice-to-have; not critical for MVP

#### #216: Mobile Responsiveness + Accessibility
- **Board Status**: Backlog
- **Score**: 1.0 (independent, can run parallel)
- **Estimate**: 2-3 days
- **Defer**: Can be done by different agent in parallel

#### #217: Local Analytics Instrumentation
- **Board Status**: Backlog
- **Score**: 1.0 (independent)
- **Estimate**: 1-2 days
- **Defer**: Not critical for core features

#### #218: Data Export CLI
- **Board Status**: Backlog
- **Score**: 0.67 (low demand)
- **Estimate**: 2-3 days
- **Defer**: GDPR nice-to-have; low urgency

#### #219: Version Strategy + Changelog
- **Board Status**: Backlog
- **Impact**: 2/5 (release management)
- **Effort**: 1/5 (doc + semver)
- **Dependencies**: 1 (#212)
- **Score**: 2.0
- **Estimate**: 4-8 hours
- **Do After**: #212 (CI pipeline)

---

## Recommended Work Order (By Phase)

### Phase 1: Foundation (Week 1 — 3-4 days)
1. ✅ **#212**: CI Pipeline (verify or implement)
2. ✅ **#213**: SQL Security Audit (verify or fix)
3. ⏳ **#197**: Continue Indexing (if blocker for #221)

### Phase 2: Architecture Refactor (Week 2 — 3-4 days)
4. 🚀 **#211**: Decompose server.js (start after Phase 1)
5. ⚡ **#214**: Loading States (can run in parallel)

### Phase 3: Settings & Config (Week 3 — 5-6 days)
6. 🎯 **#223**: AI Provider Cards (depends on #211)
7. 🎛️ **#224**: Per-Channel Matrix (depends on #223)
8. 🏠 **#221**: Settings Hub (integrator, last)

### Phase 4: Polish & Extras (Week 4+ — optional)
9. 🔗 **#220**: LinkedIn Enablement (needs scoping)
10. 📚 **#215**: Onboarding (nice-to-have)
11. 📱 **#216**: Mobile Responsiveness (parallel work)
12. 📊 **#217**: Analytics (optional)
13. 💾 **#218**: Data Export (optional)
14. 📝 **#219**: Version Strategy (after #212)

---

## Update Protocol

**This document must be refreshed:**
- ✅ Every sprint completion
- ✅ When issue scope changes significantly
- ✅ When effort estimate changes >20%
- ✅ When dependency relationships change

**Sync checklist**:
- [ ] Verify board status matches this document
- [ ] Update score if effort changed
- [ ] Update dependencies if new blockers discovered
- [ ] Commit with message: `docs: update backlog prioritization (SPRINT_X)`

**Next scheduled update**: 2026-02-28 (end of Sprint 1)
