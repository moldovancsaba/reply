# Reply Core UI

The Reply Core web app: React + TypeScript + Vite, built **only** from the Sovereign Squad General Design System (`@sovereignsquad/gds`). The service serves the build at `/`; see [`../../docs/CORE_UI.md`](../../docs/CORE_UI.md) for the screens, states, theme and accessibility gate and [`../../docs/DESIGN_SYSTEM.md`](../../docs/DESIGN_SYSTEM.md) for the design-system rules.

## Install

The GDS packages (`@sovereignsquad/gds`, `gds-a11y`, `gds-eslint-config` and their dependencies) are public on the npm registry, so `npm install` needs no token and no `.npmrc`. The lockfile pins version 6.8.0 with its integrity hashes.

```bash
cd core/ui && npm ci
```

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server on :5173, proxying `/api` to the service on 45511 (add `REPLY_CORE_ALLOWED_ORIGINS=http://127.0.0.1:5173` to the service) |
| `npm run build` | type-check and build to `dist/` (the service serves it) |
| `npm run lint` | ESLint with `@sovereignsquad/gds-eslint-config` (no raw colours or sizes, no non-GDS UI imports) plus a rule that forbids importing `@mantine/*` directly |
| `npm test` | Vitest unit tests (API client, health polling, shell, inbox, thread, composer, drafting, profile, search and sources helpers) |
| `npm run test:e2e` | Playwright against a real service: routing, keyboard, mobile, service down/up, and the GDS accessibility gate on every route in light and dark |
| `npm run gen:api` | regenerates `src/api/types.gen.ts` from `../schema/*.json` (verify fails if it is stale) |
| `npm run verify` | all of the above plus the bundle budget (`check:bundle`, 250 KB gzipped) |

Playwright runs every spec twice: in the Google Chrome installed on your machine (project `chrome`, no download) and in Playwright's WebKit, Safari's engine (project `webkit`; once: `npx playwright install webkit`, about 300 MB). `npx playwright test --project=webkit` runs one of them. Where Safari behaves differently by design the spec says so: it tabs to every control only with Option held (`Alt+Tab`), does not focus a button when it is clicked, has no clipboard permission to grant, and stands still under Playwright's fake clock.

## Structure

```text
src/main.tsx          GDS stylesheet (once, first), GdsProvider with the Reply theme, router, query client
src/App.tsx           routes, toast and overlay providers
src/theme/            the Reply theme (GDS default plus documented accessibility corrections)
src/shell/            AppShell (DiscoveryShell, sidebar, health banner, notices, first-run redirect), nav destinations
src/routes/           one lazy module per screen (inbox, thread, profile, search, sources sub-folders)
src/patterns/         TimelineEntry, the local message-entry pattern composed from GDS parts
src/components/       ErrorBoundary, SkipLink, ConfirmPanel
src/api/              fetch client (timeouts, error envelope), react-query hooks, generated response types
src/hooks/, src/lib/  health polling; time formatting, snippets, throttling, media queries
e2e/                  Playwright specs, service launcher, fake Ollama, accessibility helper
```
