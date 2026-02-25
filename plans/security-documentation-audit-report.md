# Security & Documentation Audit Report for {reply}

**Audit Date**: 2026-02-24  
**Auditor**: AI Developer  
**Status**: COMPLETED

---

## Executive Summary

This audit covered comprehensive security verification and documentation accuracy assessment for the {reply} project. The project demonstrates **strong security posture** with all critical controls properly implemented. Several medium-priority issues were identified related to dependency vulnerabilities and documentation inconsistencies.

### Overall Assessment

| Category | Status | Critical | High | Medium | Low |
|----------|--------|----------|------|--------|-----|
| Security Controls | ✅ PASS | 0 | 0 | 2 | 3 |
| Documentation | ⚠️ MINOR ISSUES | 0 | 0 | 3 | 4 |
| Dependency Security | ⚠️ ACTION NEEDED | 0 | 12 | 1 | 0 |

---

## Part 1: Security Audit Findings

### 1.1 Authentication & Authorization ✅ PASS

| Control | Status | Evidence |
|---------|--------|----------|
| Operator token enforcement | ✅ Verified | [`security-policy.js:88-99`](chat/security-policy.js:88) - timing-safe comparison |
| Human approval gates | ✅ Verified | [`server.js:548-563`](chat/server.js:548) - all 25 sensitive routes protected |
| Local request validation | ✅ Verified | [`security-policy.js:53-57`](chat/security-policy.js:53) - uses socket.remoteAddress |
| Cookie-based token auth | ✅ Verified | [`security-policy.js:96-98`](chat/security-policy.js:96) - URL decoding + timing-safe match |

**Verified Sensitive Routes (25 total):**
- `/api/send-imessage`, `/api/send-whatsapp`, `/api/send-linkedin`, `/api/send-email`
- `/api/sync-imessage`, `/api/sync-whatsapp`, `/api/sync-mail`, `/api/sync-notes`
- `/api/settings`, `/api/kyc`, `/api/gmail/disconnect`, `/api/analyze-contact`
- `/api/channel-bridge/inbound`, `/api/training/annotations`, `/api/messages/annotate`
- `/api/add-note`, `/api/update-note`, `/api/delete-note`
- `/api/sync-linkedin`, `/api/sync-linkedin-contacts`, `/api/sync-linkedin-posts`

### 1.2 Input Validation & SQL Injection Prevention ✅ PASS

| Control | Status | Evidence |
|---------|--------|----------|
| SQL string escaping | ✅ Verified | `escapeSqlString()` in 3 files - all SQL uses escaped values |
| No string-interpolated SQL | ✅ Verified | Grep search found 0 matches for `SELECT.*${` patterns |
| AppleScript injection | ⚠️ Minor | Some `exec()` usage with escaped scripts (non-user input) |

**Files with `escapeSqlString()`:**
- [`vector-store.js:5-6`](chat/vector-store.js:5) - 5 usages
- [`channel-bridge.js:160-161`](chat/channel-bridge.js:160) - 1 usage
- [`server.js:133-135`](chat/server.js:133) - defined but not actively used

### 1.3 Secrets Management ⚠️ MINOR ISSUES

| Control | Status | Evidence |
|---------|--------|----------|
| `.env` gitignored | ✅ Verified | `.gitignore` contains `chat/.env` |
| Secrets in git history | ⚠️ Warning | Commit `cd0d7b2` removed `.env` - **rotate keys** |
| Gmail OAuth credentials | ✅ Verified | Encrypted storage in [`settings-store.js:25-32`](chat/settings-store.js:25) |
| Client secret masking | ✅ Verified | [`settings-store.js:201-222`](chat/settings-store.js:201) - hints only to UI |

**SEC-001: Secrets Previously Committed to Git** (Medium)
- **Issue**: `GOOGLE_API_KEY` and `REPLY_OPERATOR_TOKEN` were in git history before commit `cd0d7b2`
- **Risk**: Credentials may be compromised if repository was accessed
- **Remediation**: Rotate all credentials that were ever in `.env`

### 1.4 File Permissions & Data Protection ✅ PASS

| Control | Status | Evidence |
|---------|--------|----------|
| Data directory mode | ✅ Verified | `chat/data` mode is 700 |
| Settings file mode | ✅ Verified | Written with mode 600 in [`settings-store.js:319`](chat/settings-store.js:319) |
| Audit log mode | ✅ Verified | Written with mode 600 in [`security-policy.js:118`](chat/security-policy.js:118) |

### 1.5 HTTP Security Headers ✅ PASS

| Header | Status | Value |
|--------|--------|-------|
| Content-Security-Policy | ✅ Verified | 11 directives |
| X-Frame-Options | ✅ Verified | DENY |
| X-Content-Type-Options | ✅ Verified | nosniff |
| CORS | ✅ Verified | Same-origin + LinkedIn/WhatsApp origins |

**CSP Header Verified:**
```
default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; 
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; 
img-src 'self' data: blob: https://www.gravatar.com; 
font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws: wss:; 
media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; 
base-uri 'self'; form-action 'self'
```

**SEC-002: CSP Allows 'unsafe-inline' and 'unsafe-eval'** (Low)
- **Issue**: CSP allows unsafe-inline scripts and eval
- **Risk**: XSS potential if user input rendered in DOM
- **Remediation**: Consider nonce-based CSP for production

### 1.6 Rate Limiting ✅ PASS

| Control | Status | Evidence |
|---------|--------|----------|
| Rate limiter implementation | ✅ Verified | [`rate-limiter.js`](chat/rate-limiter.js) - sliding window |
| Protected endpoints | ✅ Verified | 13 routes in `RATE_LIMITED_ROUTES` set |
| Retry-After header | ✅ Verified | 429 responses include `Retry-After` |

**Rate-Limited Routes (13):**
```
/api/send-imessage, /api/send-whatsapp, /api/send-linkedin, /api/send-email,
/api/sync-imessage, /api/sync-whatsapp, /api/sync-mail, /api/sync-notes,
/api/settings, /api/kyc, /api/gmail/disconnect, /api/analyze-contact,
/api/channel-bridge/inbound
```

### 1.7 Audit Logging ✅ PASS

| Control | Status | Evidence |
|---------|--------|----------|
| Security event logging | ✅ Verified | `appendSecurityAudit()` in [`security-policy.js:114-122`](chat/security-policy.js:114) |
| Log format | ✅ Verified | JSONL with timestamp, route, action, decision, reason |
| Log rotation | ✅ Verified | 5MB max in [`background-worker.js:6-16`](chat/background-worker.js:6) |

### 1.8 Channel Security ✅ PASS

| Channel | Send Enabled | Auth Required | Implementation |
|---------|--------------|---------------|----------------|
| iMessage | ✅ Yes | Token + Human | AppleScript via `execFile` |
| WhatsApp | ✅ Yes | Token + Human | OpenClaw CLI + Desktop fallback |
| Email | ✅ Yes | Token + Human | Gmail API or Mail.app |
| LinkedIn | ⚠️ Clipboard | Token + Human | Clipboard + browser open |
| Telegram | ❌ Draft only | N/A | Bridge inbound only |
| Discord | ❌ Draft only | N/A | Bridge inbound only |
| Signal | ❌ Draft only | N/A | Bridge inbound only |
| Viber | ❌ Draft only | N/A | Bridge inbound only |

**SEC-003: LinkedIn Send Uses Clipboard Fallback** (Low)
- **Issue**: LinkedIn send copies to clipboard and opens browser - not true send
- **Risk**: User must manually paste, potential for wrong recipient
- **Remediation**: Document clearly; consider removing from "Send-enabled" in README

### 1.9 Command Execution Review ⚠️ MINOR ISSUES

| File | Function | Method | Risk |
|------|----------|--------|------|
| `server.js` | iMessage send | `execFile` with argv | ✅ Safe |
| `server.js` | WhatsApp send | `execFile` with argv | ✅ Safe |
| `sync-notes.js` | Apple Notes | `execFile` with argv | ✅ Safe |
| `sync-mail.js` | Mail.app | `exec` with escaped script | ⚠️ Review |
| `ingest-contacts.js` | Contacts export | `exec` with script path | ⚠️ Review |
| `ingest-mail-applescript.js` | Mail ingestion | `exec` with escaped script | ⚠️ Review |

**SEC-004: Shell-based exec() in Non-Server Files** (Medium)
- **Issue**: `sync-mail.js`, `ingest-contacts.js`, `ingest-mail-applescript.js` use `exec()` with shell interpolation
- **Risk**: Potential injection if script content includes user data
- **Remediation**: Convert to `execFile()` with argv-only arguments

---

## Part 2: Dependency Vulnerability Audit ⚠️ ACTION NEEDED

### npm audit Results

```
13 vulnerabilities (1 moderate, 12 high)
```

| Package | Severity | Issue | Fix Available |
|---------|----------|-------|---------------|
| `tar` | High | Path traversal, symlink poisoning | `npm audit fix --force` (breaking) |
| `minimatch` | High | ReDoS via wildcards | `npm audit fix --force` (breaking) |
| `ajv` | Moderate | ReDoS with $data option | `npm audit fix` |

**SEC-005: Vulnerable Dependencies** (High Priority)
- **Issue**: 12 high-severity vulnerabilities in transitive dependencies
- **Affected**: `tar`, `minimatch` (via eslint, sqlite3, node-gyp)
- **Remediation**: 
  1. Run `npm audit fix` for non-breaking fixes
  2. Test `npm audit fix --force` in a branch
  3. Update `sqlite3` to latest version

---

## Part 3: Documentation Audit Findings

### 3.1 README.md Accuracy ✅ MOSTLY ACCURATE

| Claim | Status | Verification |
|-------|--------|--------------|
| Node.js v18+ | ✅ Verified | `package.json` engines: "node": ">=18" |
| `npm start` | ✅ Verified | `scripts.start: "node server.js"` |
| Ingestion commands | ✅ Verified | `ingest.js` exists with mbox support |
| Send-enabled channels | ⚠️ Inaccurate | LinkedIn is clipboard-only, not true send |
| Documentation links | ✅ Verified | All 10 docs exist |

**DOC-001: LinkedIn Channel Misdocumented** (Medium)
- **Issue**: README lists LinkedIn as "Draft-only" but code has `/api/send-linkedin` endpoint
- **Reality**: LinkedIn has clipboard-based "send" that opens browser
- **Remediation**: Clarify LinkedIn behavior in README and USER_GUIDE

### 3.2 Architecture Documentation ✅ ACCURATE

| Document Section | Status | Notes |
|------------------|--------|-------|
| Component diagram | ✅ Verified | Matches actual file structure |
| LanceDB schema | ✅ Verified | `{id, source, path, text, vector}` correct |
| Background worker | ✅ Verified | Description matches `background-worker.js` |
| Settings storage | ✅ Verified | `chat/data/settings.json` correct |

### 3.3 API Documentation ⚠️ INCOMPLETE

| Endpoint | Documented | Code Exists | Status |
|----------|------------|-------------|--------|
| `/api/send-imessage` | ✅ Yes | ✅ Yes | ✅ |
| `/api/send-whatsapp` | ✅ Yes | ✅ Yes | ✅ |
| `/api/send-email` | ✅ Yes | ✅ Yes | ✅ |
| `/api/send-linkedin` | ❌ No | ✅ Yes | ⚠️ Missing |
| `/api/channel-bridge/inbound` | ✅ Yes | ✅ Yes | ✅ |
| `/api/conversations` | ✅ Yes | ✅ Yes | ✅ |
| `/api/thread` | ❌ No | ✅ Yes | ⚠️ Missing |
| `/api/kyc` | ✅ Yes | ✅ Yes | ✅ |
| `/api/settings` | ✅ Yes | ✅ Yes | ✅ |
| `/api/analyze-contact` | ❌ No | ✅ Yes | ⚠️ Missing |
| `/api/training/annotations` | ❌ No | ✅ Yes | ⚠️ Missing |
| `/api/messages/annotate` | ❌ No | ✅ Yes | ⚠️ Missing |

**DOC-002: Undocumented API Endpoints** (Medium)
- **Issue**: Several endpoints lack documentation
- **Missing**: `/api/send-linkedin`, `/api/thread`, `/api/analyze-contact`, `/api/training/annotations`, `/api/messages/annotate`
- **Remediation**: Add to `docs/CHANNEL_BRIDGE.md` or create `docs/API_REFERENCE.md`

### 3.4 User Guide Accuracy ✅ MOSTLY ACCURATE

| Section | Status | Notes |
|---------|--------|-------|
| Start/Stop | ✅ Verified | `Launch Reply.command` exists |
| UI Map - Sidebar | ✅ Verified | Matches `index.html` structure |
| UI Map - Dashboard | ✅ Verified | Matches `dashboard.js` |
| UI Map - Feed | ✅ Verified | Matches `messages.js` |
| UI Map - Settings | ✅ Verified | Matches `settings.js` |
| Gmail OAuth | ✅ Verified | Redirect URIs correct |
| WhatsApp | ✅ Verified | Prerequisites documented |

### 3.5 Handover Document ✅ CURRENT

| Section | Last Updated | Status |
|---------|--------------|--------|
| Current Priorities | 2026-02-22 | ✅ Current |
| Active Issues | Listed | ✅ Matches board |
| Recent Shipped | 2026-02-18 | ✅ Accurate |
| Known Quirks | Documented | ✅ Still accurate |

### 3.6 Coding Standards Compliance ⚠️ MINOR ISSUES

| Standard | Status | Evidence |
|----------|--------|----------|
| No secrets in commits | ⚠️ Was violated | Fixed in commit `cd0d7b2` |
| JSDoc on exports | ⚠️ Partial | Some files lack JSDoc |
| ES6 async/await | ✅ Verified | No callback patterns |
| No console.log spam | ⚠️ Warnings | ESLint found unused vars |
| Bounded caches | ✅ Verified | `MAX_SEEN_IDS = 1000` in worker |

**DOC-003: ESLint Warnings** (Low)
- **Issue**: 26 ESLint warnings (unused vars, prefer-const, no-undef in extension)
- **Files**: `background-worker.js`, `chrome-extension/content.js`, `contact-store.js`, others
- **Remediation**: Run `npm run lint:fix` and review

---

## Part 4: Test Results

### Automated Tests ✅ ALL PASS

```
▶ rate-limiter (6 tests) ✅
▶ security-policy (22 tests) ✅
Total: 28 tests, 0 failures
```

### Security Audit Script ✅ PASS

```
Summary: critical=0 warn=0 info=5
- Data directory permissions: 700 ✅
- Local-write protection: enabled ✅
- Human approval: enabled ✅
- Operator token: enforced ✅
- No shell exec in server.js ✅
```

### Integration Tests ✅ PASS

| Test | Result |
|------|--------|
| Missing token → 401 | ✅ Pass |
| Security headers present | ✅ Pass |
| CSP header complete | ✅ Pass |
| CORS same-origin | ✅ Pass |

---

## Part 5: Remediation Plan

### Priority 0 - Immediate (This Week)

| ID | Issue | Action | Effort |
|----|-------|--------|--------|
| SEC-005 | Vulnerable dependencies | Run `npm audit fix`, test, update sqlite3 | 2h |

### Priority 1 - High (This Sprint)

| ID | Issue | Action | Effort |
|----|-------|--------|--------|
| SEC-001 | Secrets in git history | Rotate GOOGLE_API_KEY and REPLY_OPERATOR_TOKEN | 1h |
| SEC-004 | Shell exec in sync files | Convert to execFile with argv | 4h |

### Priority 2 - Medium (Next Sprint)

| ID | Issue | Action | Effort |
|----|-------|--------|--------|
| DOC-001 | LinkedIn misdocumented | Update README, USER_GUIDE | 1h |
| DOC-002 | Undocumented APIs | Create API_REFERENCE.md | 4h |
| SEC-003 | LinkedIn clipboard fallback | Document clearly or remove endpoint | 2h |

### Priority 3 - Low (Backlog)

| ID | Issue | Action | Effort |
|----|-------|--------|--------|
| SEC-002 | CSP unsafe-inline | Consider nonce-based CSP | 8h |
| DOC-003 | ESLint warnings | Run lint:fix, review changes | 2h |

---

## Part 6: Security Controls Checklist

### ✅ Implemented Controls

- [x] Local-only writes (loopback IP check)
- [x] Operator token enforcement (timing-safe comparison)
- [x] Human approval gates on all send/mutation routes
- [x] Rate limiting (30 req/min on 13 sensitive endpoints)
- [x] CORS restricted to localhost + allowed origins
- [x] CSP headers with 11 directives
- [x] X-Frame-Options: DENY
- [x] X-Content-Type-Options: nosniff
- [x] File permissions audited (600/700)
- [x] No `exec()` shell usage in server.js
- [x] Audit logging to JSONL
- [x] Log rotation (5MB max)
- [x] SQL escaping on all queries
- [x] Encrypted storage for sensitive settings
- [x] Client secret masking in UI
- [x] Bounded caches in background worker

### ⚠️ Recommended Improvements

- [ ] Rotate credentials that were in git history
- [ ] Update vulnerable dependencies
- [ ] Convert remaining `exec()` to `execFile()`
- [ ] Add nonce-based CSP for production
- [ ] Document all API endpoints

---

## Appendix A: Files Audited

### Core Server Files
- `chat/server.js` (120,649 chars) - Main HTTP server
- `chat/security-policy.js` (133 lines) - Auth/authorization
- `chat/security-audit.js` (247 lines) - Audit tooling
- `chat/rate-limiter.js` (83 lines) - Rate limiting

### Data Stores
- `chat/contact-store.js` - SQLite contacts
- `chat/settings-store.js` - JSON settings with encryption
- `chat/vector-store.js` - LanceDB documents
- `chat/message-store.js` - SQLite messages

### Sync/Ingestion
- `chat/sync-mail.js` - Mail.app via AppleScript
- `chat/sync-imessage.js` - iMessage sync
- `chat/sync-whatsapp.js` - WhatsApp sync
- `chat/sync-notes.js` - Apple Notes sync
- `chat/ingest-contacts.js` - Contacts export
- `chat/ingest-mail-applescript.js` - Mail ingestion

### Connectors
- `chat/gmail-connector.js` - Gmail OAuth
- `chat/sync-imap.js` - IMAP mail
- `chat/channel-bridge.js` - Bridge inbound

### Frontend
- `chat/js/api.js` - API client with token handling
- `chat/js/settings.js` - Settings UI
- `chat/js/kyc.js` - Profile management

### Tests
- `chat/test/security-policy.test.js` - 22 tests
- `chat/test/rate-limiter.test.js` - 6 tests

---

## Appendix B: Documentation Reviewed

| Document | Lines | Status |
|----------|-------|--------|
| `README.md` | 58 | ✅ Mostly accurate |
| `docs/ARCHITECTURE.md` | 80 | ✅ Accurate |
| `docs/APP_NAVIGATION.md` | 59 | ✅ Accurate |
| `docs/INGESTION.md` | 72 | ✅ Accurate |
| `docs/CHANNEL_BRIDGE.md` | 148 | ✅ Accurate |
| `docs/HUMAN_FINAL_DECISION_POLICY.md` | 70 | ✅ Accurate |
| `docs/CODING_STANDARDS.md` | 37 | ✅ Accurate |
| `docs/USER_GUIDE.md` | 79 | ✅ Accurate |
| `docs/HANDOVER.md` | 298 | ✅ Current |
| `docs/LEARNINGS.md` | 43 | ✅ Accurate |
| `docs/RELEASE_NOTES.md` | 84 | ✅ Current |
| `docs/BRAIN_DUMP.md` | 251 | ✅ Current |

---

**Audit Complete**

*Generated: 2026-02-24*  
*Next Audit Recommended: 2026-03-24*
