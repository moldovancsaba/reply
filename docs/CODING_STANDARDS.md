# Coding Standards & Developer Guidelines

## User Mandates
1.  **Documentation = Code:** Every PR must update relevant docs. No "TBD".
2.  **Minimal Dependencies:** Use standard libs. No frameworks unless approved.
3.  **Production-Grade:** 0 vulnerabilities (`npm audit`), strict error handling.

## Code Style (JavaScript/Node.js)
*   **Syntax:** Modern ES6+ (Async/Await, Destructuring).
*   **Imports:** `require` for Node.js backend (CommonJS).
*   **Comments:** Plain, unambiguous English. Explain *why*, not just *what*.
*   **Formatting:** Consistent indentation (4 spaces or 2 spaces, strictly applied).

## Git & Project Management
*   **Single Source of Truth:** [GitHub Project Board](https://github.com/users/moldovancsaba/projects/1).
*   **Commit Messages:** Descriptive and linked to issue numbers (e.g., "feat(#172): implement hybrid search").
*   **PR/Merge:** All features must pass verification (UAT) before closing issues.

## Testing & Verification
*   **Unit Tests:** Create standalone verification scripts (e.g., `verify-hybrid-search.js`).
*   **UAT:** Include a "How to Test" section in every issue closure.

## Dependency Management
*   **Checking:** Run `npm audit` before every commit.
*   **Updates:** Stick to LTS versions. Avoid experimental flagged packages.
