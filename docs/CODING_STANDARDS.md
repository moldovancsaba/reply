# Coding Standards & Developer Guidelines

## User Mandates
1.  **Documentation = Code:** Every PR must update relevant docs. No "TBD".
2.  **Minimal Dependencies:** Use standard libs. No frameworks unless approved.
3.  **Production-Grade:** 0 vulnerabilities (`npm audit`), strict error handling.
4.  **Security First:** NEVER commit secrets/API keys. Use `.env`.
5.  **Native-App Standard:** `{reply}` is a native macOS app product. Do not introduce website-style UX metaphors, page-era dead ends, or browser-only assumptions into shipped operator flows.

## Native App Requirements
*   **Native-First UX:** Every shipped user flow must behave like a native app flow even when implemented inside the embedded workspace surface. Avoid standalone “website” patterns such as page detours for core actions, “Back to Chat” footers, or orphan subpages that break the product shell.
*   **Single Product Shell:** Navigation must stay inside the app shell. Primary transitions should happen through top-level app chrome, in-app panels, or modals.
*   **No Website Metaphors in Product UI:** Do not label native-product actions or surfaces in a way that implies `{reply}` is a website. The app is local software with local services.
*   **Offline-Available Visual Assets:** Every visual element used by the shipped app must be available locally and render without remote fetches. This includes icons, logos, SVGs, fonts, theme tokens, and UI primitives.
*   **No Runtime CDN / Remote UI Dependencies:** Do not depend on remote icon packs, remote fonts, browser-hosted assets, or third-party UI delivery for any shipped operator surface.
*   **Embedded Asset Preference:** When a visual system can be embedded directly into the app runtime safely, prefer embedded delivery over browser-path asset lookup. Example: the local icon sprite is embedded into the DOM runtime rather than resolved from a web-style asset URL.

## UI Implementation Rules
*   **Semantic Theming Only:** Screen chrome, panels, menus, controls, and overlays must derive from semantic theme variables. Hardcoded one-off foreground/background fixes are not allowed.
*   **No Screen-Local Patch Styling:** If a component needs repeated per-screen fixes, the primitive or token layer is wrong. Fix the shared adapter or primitive instead.
*   **Readable In Day and Night:** Every UI change must remain legible in light mode, dark mode, and system-follow mode.
*   **Top-Level Action Consistency:** Header controls and shell actions should behave as a coherent native tool strip. Do not mix oversized pills, text-heavy menus, and icon-only controls arbitrarily.
*   **No Floating Rescue Menus for Core Actions:** Core actions belong in the primary app chrome, not in surprise floating action menus, unless the interaction is explicitly transient and justified.

## Icon Standards
*   **Local Icon System Only:** All icons must come from the local shared icon implementation, not emoji, remote fonts, or ad hoc glyphs.
*   **Consistent Icon Size:** App-controlled icons must derive from one shared size token or equivalent primitive. Do not hand-tune icon sizes screen by screen.
*   **Consistent Icon Button Pattern:** App action icons must be implemented through the shared icon-button pattern. Do not create inconsistent wrapped shapes, mixed paddings, or per-screen button geometry unless the design system changes for everyone.
*   **No Emoji as Shipped UI Icons:** Emoji may appear in user content, never as the product’s own shipped iconography.
*   **Inline and Dashboard Icons Count Too:** Dashboard, settings, profile actions, shell chrome, and state indicators must follow the same icon system as the rest of the app.
*   **Deterministic Native App Icons:** The native app icon must be generated from local deterministic source code or checked-in local assets. Do not build release icons through Quick Look thumbnails, browser screenshots, or heuristic raster pipelines.
*   **Bundle/Icon Integrity:** Treat `Contents/Info.plist`, `CFBundleIconFile`, and the bundled `.icns` asset as one release artifact. If one changes, the install verification must re-check all of them together.

## Rendering & Asset Hygiene
*   **No Raw Markup Leakage:** Renderer code must never guess whether content is HTML, an asset path, or icon markup using brittle string inspection. Use explicit contracts.
*   **Structured Rendering Contracts:** If a component can render multiple visual source types, use explicit fields such as `iconName`, `iconAsset`, or equivalent typed input rather than heuristic parsing.
*   **Graceful Local Fallbacks:** Missing local assets must fail visibly in development and degrade safely in production without corrupting surrounding content.
*   **No Mixed Legacy Paths:** Do not keep both “old website asset path” and “new native asset path” logic alive in the same rendering surface without a clear migration boundary.

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
*   **Single Source of Truth (SSOT) for `{reply}`:** The [`{reply}` GitHub Project (#7)](https://github.com/users/moldovancsaba/projects/7) and **`moldovancsaba/reply`** issues are where `{reply}` tasks are tracked. Portfolio-wide work may still use `mvp-factory-control` / Project #1 for *other* products.
*   **NO local task files:** Never use local `task.md`, `ROADMAP.md`, `IDEABANK.md`, etc. as SSOT. All `{reply}` tasks belong on Project #7 with issues in `moldovancsaba/reply`.
*   **Commit Messages:** Descriptive and linked to issue numbers in **`moldovancsaba/reply`** (e.g., `feat(#42): implement hybrid search`).
*   **PR/Merge:** All features must pass verification (UAT) before closing issues.

## Testing & Verification
*   **Unit Tests:** Create standalone verification scripts (e.g., `verify-hybrid-search.js`).
*   **UAT:** Include a "How to Test" section in every issue closure.
*   **Theme Verification:** UI changes must be checked in day, night, and system-follow modes.
*   **Installed-App Verification:** For user-facing UI work, verify against the installed native app runtime, not only a dev server.
*   **Visual Regression Checks:** Any change to navigation, settings, dashboards, or icon primitives should include a direct manual or scripted verification that content still renders and no raw HTML / placeholder glyphs leak into the UI.
*   **Installer Verification:** Native app install/update scripts must verify bundle integrity after copy and refresh LaunchServices/Dock metadata so macOS re-reads the shipped icon from the repaired bundle.

## Dependency Management
*   **Checking:** Run `npm audit` before every commit.
*   **Updates:** Stick to LTS versions. Avoid experimental flagged packages.

## Reliability & Long-Running Processes
*   **Memory Management:** Use bounded caches (e.g., LRU or fixed-size Set/Map) for any robust long-running process (like background workers). Unbounded growth is forbidden.
*   **Error Recovery:** Background workers must catch errors, log them, and continue polling (no silence crashes).
