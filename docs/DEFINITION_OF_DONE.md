# Definition of Done (DoD) & Developer Conduct

**This document outlines the mandatory standards for all contributions to the 'Reply' project.**
Every task, pull request, or commit must satisfy these criteria before being considered "Done."

## 1. Code Quality & Integrity
*   **Production-Grade:** Code must be error-free, warning-free, and ready for deployment. No "fix later" mentality.
*   **Dependency Discipline:**
    *   Only use approved, LTS dependencies.
    *   No deprecated packages or unnecessary "helper" libraries unless justified.
    *   Security audited (0 vulnerabilities).
*   **Clean Code:**
    *   Clear, unambiguous English comments explaining logic.
    *   No commented-out code or `console.log` spam (debug logs must be removed or behind a flag).
    *   Consistent formatting (Prettier/ESLint standards).

## 2. Documentation = Code
**"If it’s not documented, it’s not done."**
*   **Synchronized Updates:** Any change to logic, API, or feature MUST trigger an immediate update to:
    *   `README.md` (if applicable).
    *   The relevant file in `docs/` (e.g., `INGESTION.md` if ingestion logic changes).
    *   Inline code comments.
*   **No Placeholders:** Avoid "TBD" or filler text. Documentation must reflect the true state of the system.

## 3. Verification & Testing
*   **Automated Verification:** Every feature must include a verification script (e.g., `chat/verify-*.js`) proving it works.
*   **Manual Verification:** The developer must manually verify the change (e.g., running the app, checking UI) and document the results.
*   **Zero Regressions:** Existing functionality (e.g., previous verifications) must still pass.

## 4. Project Management (GitHub Board) & Issues
*   **Single Source of Truth:** The [`{reply}` GitHub Project (#7)](https://github.com/users/moldovancsaba/projects/7) and issues in [`moldovancsaba/reply`](https://github.com/moldovancsaba/reply) are the authority for `{reply}` roadmap, backlog, and tasks.
*   **No Local Tracking:** Do NOT create or maintain local `IDEABANK.md`, `ROADMAP.md`, `TASKLIST.md`, or similar tracking files as SSOT. If they exist, they must only contain a link to the project board.
*   **Issues in this repo:** All **new** `{reply}` issues are created and managed in **`moldovancsaba/reply`** and linked to **Project #7** (not in `mvp-factory-control` for new work).
*   **Issue Lifecycle:**
    *   **Create:** Open issue in `moldovancsaba/reply` with title format `{reply}: <short description>`.
    *   **Record:** Add issue to [Project #7](https://github.com/users/moldovancsaba/projects/7) immediately (mandatory).
    *   **Start:** Assign issue to self, set board status to `In Progress` (or equivalent).
    *   **Finish:**
        *   Comment on the issue with a summary of changes and verification results.
        *   **User Testing Instructions:** Include a clear "How to Test" section for the User (e.g., specific commands, URL to visit, or file to check).
        *   Ensure board status is `Done` (or equivalent).
        *   Close the issue via GitHub CLI (`gh issue close <id> --repo moldovancsaba/reply`).
        *   Verify the issue remains visible on Project #7 as expected.

---
*Created by the AI Developer to codify the Product Owner's requirements.*
