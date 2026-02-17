# Developer Handover & Context

**Target Audience:** New Developers & AI Agents  
**Identity:** **Agnes** (Lead Developer for "Reply")

> **CRITICAL RULE:** This document MUST be updated after every single task completion to reflect the new state of the system, roadmap, and known issues.

## 🚨 Critical Documentation (Read First)
Before starting ANY work, you MUST read **[docs/PROJECT_MANAGEMENT.md](file:///Users/moldovancsaba/Projects/reply/docs/PROJECT_MANAGEMENT.md)**.
*   **Why:** It explains how to use the Project Board as separate Source of Truth, how to fill fields, and why we strictly avoid prefixes in titles.

## 📂 Key File Index (What is what)
You will find these files in the repository. Use them for specific needs:

*   **[README.md](file:///Users/moldovancsaba/Projects/reply/README.md):** The entry point; installation, quickstart, and feature overview.
*   **[docs/ARCHITECTURE.md](file:///Users/moldovancsaba/Projects/reply/docs/ARCHITECTURE.md):** High-level system design, data flow diagrams (Mermaid), and component breakdown.
*   **[docs/INGESTION.md](file:///Users/moldovancsaba/Projects/reply/docs/INGESTION.md):** Detailed guide on how data (files, emails, notes) enters the system and is vectorized.
*   **[docs/CODING_STANDARDS.md](file:///Users/moldovancsaba/Projects/reply/docs/CODING_STANDARDS.md):** Rules for code style, dependency management, and verification steps.
*   **[docs/PROJECT_MANAGEMENT.md](file:///Users/moldovancsaba/Projects/reply/docs/PROJECT_MANAGEMENT.md):** The rulebook for the GitHub Project Board, SSOT, and issue structure.
*   **[docs/RELEASE_NOTES.md](file:///Users/moldovancsaba/Projects/reply/docs/RELEASE_NOTES.md):** Log of delivered features and changelog.
*   **[docs/HANDOVER.md](file:///Users/moldovancsaba/Projects/reply/docs/HANDOVER.md):** (This file) Context, roadmap status, and agent memory.

## Current State (Status Quo)
*   **Phase:** POC / MVP Factory
*   **Latest Feature:** Hybrid Search (#172) & Apple Notes Integration (#163).
*   **Stability:** Recovered, Optimized, and Stable. Fixed the Context Engine `SyntaxError`. Replaced the manual `watch-imessage.js` with a unified, SQLite-based `background-worker.js` running via `launchd`.

## 🚨 Single Source of Truth
All tasks, roadmap items, and the Idea Bank are managed **strictly** on the **[GitHub Project Board](https://github.com/users/moldovancsaba/projects/1)**.

### 🛠️ Professional Board Access (Agnes/Agent Standard)
Do **NOT** use browser-based tools for board management as they are unreliable for automated agents. Use the GitHub CLI (`gh`) exclusively for a reproducible, professional workflow.

**1. Authentication:**
```bash
gh auth status # Verify login
```

**2. List Items for 'Reply' Project:**
```bash
# Get all items, filter for 'reply' product, exclude 'Done' and 'Backlog'
gh project item-list 1 --owner moldovancsaba --format json --limit 180 | jq '[.items[] | select(.product == "reply" and (.status == "Ready" or .status == "In Progress"))]'
```

**3. Identify Top Priorities:**
```bash
# Sort by Priority field (P0, P1, P2)
gh project item-list 1 --owner moldovancsaba --format json --limit 180 | jq '[.items[] | select(.product == "reply" and (.status == "Ready" or .status == "In Progress"))] | sort_by(.priority)'
```

### ⚠️ Obsolete Local Caches (DO NOT USE)
The following files in `chat/` are **UNTRUSTED** and should be ignored or deleted to maintain SSOT integrity:
- `board_items_assign.json`
- `board_items_full.json`
- `board_items_latest.json`
*These files were individual snapshots and are NOT kept in sync. Always use the CLI to get fresh data.*

## 🧠 Brain-Dump & Context Opener
*This section provides a state-of-the-brain summary for context-reloading agents.*

### 🛡️ Operational Maintenance (Audit Checks)
Future agents must verify the following to prevent regression:
1.  **Secret leaks**: Check `.env.example` and recent commits for accidentally exposed API keys.
2.  **Dependencies**: Run `npm audit`. If `sqlite3` breaks, reinstall specifically with `npm install sqlite3@5.1.7`.
3.  **Memory Safety**: Verify that `background-worker.js` maintains its bounded cache limit (currently 1000 IDs).

### 📍 Current Strategic Focus
The objective is the **Reply Hub**: A local-first, privacy-focused digital brain that ingests personal data (Contacts, Notes, Messages) and uses a local LLM to triage and provide intelligence.

### ⚠️ Critical Blockers (The 3 "Contact" Bugs)
Before expanding the roadmap, these tactical issues must be resolved:
1.  **UI Ghosting**: Contacts exist in `contacts.json` but do not render in the UI.
2.  **Sync Gap**: Only 51/100+ contacts are being synced (AppleScript or limit issue).
3.  **Aggressive Deduplication**: Potential data loss in `contact-store.js` where mismatched merge logic deletes data.

### 🚀 Roadmap Priorities (Status: Ready/Roadmap)
1.  **Local Agent Annotation (P0)**:
    *   **Status**: Prototype exists in `kyc-agent.js` and `reply-engine.js`.
    *   **Verification**: Code confirms extraction works, but **merging into `contacts.json` is not implemented**. It remains a roadmap priority to wire this into the live data store.
2.  **Apple Notes Bridge (P1)**:
    *   **Status**: POC script `sync-notes.js` exists.
    *   **Verification**: Successfully reads via AppleScript, but lacks deeper "knowledge model" alignment and UI integration.
3.  **Multi-Channel Ingress (P1)**:
    *   **Status**: Not Implemented.
    *   **Verification**: No code found for WhatsApp/iMessage normalization beyond basic contact history fetch.

## 📂 Key File Index (What is what)

> **Rule:** Do not track tasks or ideas in local markdown files. Link them to issues on the board.

## Known Quirks
*   **LanceDB:** We use version 0.26.x. The API for hybrid search is specific (`.fullTextSearch()`). Check `verify-hybrid-search.js` for reference.
*   **Startup Failures:** If the server fails to start with a `SyntaxError` after a merge, check for duplicate `require` or constant declarations in `context-engine.js` or `reply-engine.js`.
*   **Background Processes:** `background-worker.js` handles polling. Use `launchctl list | grep com.reply.worker` to verify it's active.
