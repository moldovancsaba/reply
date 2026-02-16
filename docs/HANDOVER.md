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
*   **Stability:** Stable. Core ingestion pipelines are verified.

## Roadmap & Backlog status
*   **DONE:**
    *   #172 Hybrid Search
    *   #171 Scalable Ingestion (Mbox)
    *   #163 Apple Notes Integration
    *   #162 Knowledge Ingestion POC
*   **NEXT UP:**
    *   #174 Context Engine (Style Transfer from Sent Emails)
*   **IDEA BANK:**
    *   #175 Auto-Triage & Zero Inbox Assistant
    *   #177 Google Calendar Integration (Availability & Invites)
    *   #178 Google Drive Integration (Docs & Search)

## Known Quirks
*   **Mbox Parsing:** Large mbox files must be streamed. Do not load them into memory.
*   **LanceDB:** We use version 0.26.x. The API for hybrid search is specific (`.fullTextSearch()`). Check `verify-hybrid-search.js` for reference.
