# Coding Standards & Developer Guidelines

## User Mandates
1.  **Documentation = Code:** Every PR must update relevant docs. No "TBD".
2.  **Minimal Dependencies:** Use standard libs. No frameworks unless approved.
3.  **Production-Grade:** 0 vulnerabilities (`npm audit`), strict error handling.
4.  **Security First:** NEVER commit secrets/API keys. Use `.env`.

## Security & Data Privacy
*   **Secrets:** Credentials must be in `.env` (gitignored). Review `.env.example` to ensure no real keys are present.
*   **Vulnerability Scanning:** Run `npm audit` regularly. High-severity issues are blockers for release.
*   **Privacy:** Local-first design. Data stays on device unless explicitly sent to a user-configured API.

## Code Style (JavaScript/Node.js)
*   **Syntax:** Modern ES6+ (Async/Await, Destructuring).
*   **Imports:** `require` for Node.js backend (CommonJS).
*   **Comments:** Plain, unambiguous English. Explain *why*, not just *what*.
*   **Formatting:** Consistent indentation (2 spaces, strictly applied).
*   **Documentation:** All exported functions must have JSDoc comments explaining parameters and return values.
*   **Safety:** Avoid duplicate global or module-level declarations.

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

## Reliability & Long-Running Processes
*   **Memory Management:** Use bounded caches (e.g., LRU or fixed-size Set/Map) for any robust long-running process (like background workers). Unbounded growth is forbidden.
*   **Error Recovery:** Background workers must catch errors, log them, and continue polling (no silence crashes).
