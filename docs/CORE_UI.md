# Reply Core UI

Status: living document, owned by issue #187; each screen issue adds its section.

The app lives in [`core/ui`](../core/ui/README.md) and is built **exclusively** from the Sovereign Squad General Design System (GDS, `@sovereignsquad/gds`, https://github.com/sovereignsquad/general-design-system). The rules:

- Compose screens from GDS exports only. Never import `@mantine/*` (a lint rule forbids it), never add another component library, never write CSS files or raw colours/sizes (the GDS lint rules forbid them; spacing, colour, radius and type come from GDS tokens and props).
- Every data-rendering surface defines loading, empty, error and success with GDS `AsyncSurface` / `StateBlock`, and works at zero, one and many items.
- If a pattern does not exist in GDS, stop and open a request in the GDS repository rather than building a lookalike.
- Accessibility is a gate, not a goal: the GDS accessibility check (axe, keyboard order, contrast) runs on every route in light and dark in `npm run verify`.

## Shell contract

`DiscoveryShell` provides the header, the sidebar and the `main` landmark; below the `lg` breakpoint the sidebar collapses behind an "Open navigation" button.

| Part | Contract |
|---|---|
| Skip link | first tab stop on every page ("Skip to content"), moves focus to `#main-content` (tabindex `-1`) |
| Header | product name and a health badge: "Running vX" when the service answers, "Not running" after two failed checks |
| Sidebar | `SidebarNav` "Reply Core" with Inbox (`/inbox`, also active on `/inbox/:contactId`), Search (`/search`), Sources (`/sources`); real `<a href>` links, `aria-current="page"` on the active one; modified clicks open a new tab |
| Service unreachable | a GDS `InlineAlert` (severity error, `role="alert"`) "Reply Core is not running" with a Retry now action; the page content stays visible. It clears by itself when the service answers. |
| Loading a screen | `AsyncSurface` loading state while a lazy route loads |
| Render error | an error boundary shows a GDS error `StateBlock` with Reload instead of a blank page; it recovers when the route changes; the error goes to the console only (no telemetry) |
| Unknown route | a GDS "This page does not exist" state with a way back to Inbox |

Routes: `/` redirects to `/inbox`; `/inbox`, `/inbox/:contactId`, `/search`, `/sources`, anything else is the not-found state. Screens are lazy modules; until a screen lands its route shows a placeholder naming its issue.

## Talking to the service

`src/api/client.ts` (`fetchJson`) is the only network code. It sets a 10 s timeout (3 s for the health check), never throws (it returns `{ ok, data } | { ok: false, error }`), and understands the service error envelope (`code`, `message`, `requestId`, `retryable`, `details`). Response types are generated from `core/schema/*.json` (`npm run gen:api`); the build fails if they are stale. Health polling (`useHealth`): every 15 s while the tab is visible, paused when hidden and re-checked on return, backoff 2 s up to 30 s after a failure, "down" only after two failures in a row.

The service hosts the build (`core/src/server.js`): `index.html` is `no-cache`, files under `/assets/` are immutable, unknown non-API pages get the app (client routes), unknown API paths and non-page requests stay JSON 404s. The page carries a strict Content Security Policy (`script-src 'self'`, `connect-src 'self'`, `frame-ancestors 'none'`; inline styles are allowed because GDS sets style attributes at runtime). The build lives in `core/ui/dist` (`REPLY_CORE_UI_DIR` overrides it).

## Theme and the accessibility findings

The app uses the GDS default theme with two corrections in `src/theme/replyTheme.ts`, applied through `createPublicBrandTheme({ overrides })`. They exist because the GDS accessibility gate (axe-core in Chrome, GDS 6.8.0) fails the default theme:

| What | Default | Reply theme |
|---|---|---|
| Dimmed text (PageHeader and StateBlock descriptions), light | gray-6 `#868e96` on white = 3.3:1 | `#6b7280` = 4.8:1 |
| Dimmed text, dark | dark-2 `#828282` on `#242424` = 4.0:1 | `#9a9a9a` = 5.5:1 |
| Active navigation label | violet-6 `#7950f2` on its tint = 4.3:1 | primary shade 7 in light mode |

All GDS presets I tried (`high-contrast`, `colorblind-safe`, `royal`, `skyline`, ...) fail the same dimmed-text check, so a request was filed in the GDS repository. Remove the overrides when GDS ships defaults that pass.

Known, not failing: GDS `StateBlock` renders its title as an `h3`, which axe reports as a moderate heading-order warning after the page's `h1`. The gate fails on serious and critical findings.

## The accessibility gate (how it works, and a trap)

`npm run test:e2e` runs `createGdsA11yTest` from `@sovereignsquad/gds-a11y` on `/inbox`, `/inbox/c_123`, `/search`, `/sources` and an unknown route, in light and dark, plus the keyboard order of the shell (skip link, then the three navigation links), a 375 px phone viewport, a 320 px / reduced-motion check, and the service-down state. Serious and critical findings fail.

**Trap:** `createGdsA11yTest` navigates to the route itself, which discards any script added before the call, and its scan returns "no violations" when `axe` is not in the page. The GDS documentation example adds axe first and would therefore pass without scanning anything. `e2e/a11y.ts` adds axe as an init script (present after every navigation) and asserts it is in the page, so the gate cannot pass silently.

For a state reached by interaction (the 375 px drawer, the service-down alert) use `expectAccessibleNow`, which scans the page as it is without navigating.

## Adding a screen

1. Replace the route's `Placeholder` with the screen (a lazy module in `src/routes/`), composed from GDS only.
2. Define loading, empty, error and success (and blocked or stale where the data can be) with `AsyncSurface` / `StateBlock`; test zero, one and many.
3. Add the route to the accessibility specs for each state it can show, in light and dark, and at 375 px.
4. Keyboard: every control reachable and operable, focus managed after actions, no focus stolen by updates.
5. Add the screen's section to this document.

## Budget and checks

`npm run check:bundle` fails if the JavaScript exceeds 250 KB gzipped (currently about 193 KB, almost all of it the shared design-system chunk).
