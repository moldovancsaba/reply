# Reply Core UI

The Reply Core web app: React + TypeScript + Vite, built **only** from the Sovereign Squad General Design System (`@sovereignsquad/gds`). The service serves the build at `/`; see [`../../docs/CORE_UI.md`](../../docs/CORE_UI.md) for the shell contract, states, theme and accessibility gate.

## Install (needs a GitHub token)

The GDS packages are private to the `sovereignsquad` GitHub organisation, so `npm install` needs a token with `read:packages` that belongs to an account with access to the org. `.npmrc` already points at the registry and reads the token from the environment; never put the token in a file.

```bash
gh auth refresh -s read:packages          # once, if your gh token lacks the scope
export GITHUB_TOKEN=$(gh auth token)
cd core/ui && npm install
```

`401` on install means the token is missing, lacks `read:packages`, or its account has no access to the org (see GDS `INSTALLATION_GUIDE.md`, "Troubleshooting 401/403").

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server on :5173, proxying `/api` to the service on 45511 (add `REPLY_CORE_ALLOWED_ORIGINS=http://127.0.0.1:5173` to the service) |
| `npm run build` | type-check and build to `dist/` (the service serves it) |
| `npm run lint` | ESLint with `@sovereignsquad/gds-eslint-config` (no raw colours or sizes, no non-GDS UI imports) plus a rule that forbids importing `@mantine/*` directly |
| `npm test` | Vitest unit tests (API client, health polling, shell, error boundary) |
| `npm run test:e2e` | Playwright against a real service: routing, keyboard, mobile, service down/up, and the GDS accessibility gate on every route in light and dark |
| `npm run gen:api` | regenerates `src/api/types.gen.ts` from `../schema/*.json` (verify fails if it is stale) |
| `npm run verify` | all of the above plus the bundle budget (`check:bundle`, 250 KB gzipped) |

Playwright drives the Google Chrome installed on your machine (`channel: "chrome"`), so no browser is downloaded.

## Structure

```text
src/main.tsx          GDS stylesheet (once, first), GdsProvider with the Reply theme, router, query client
src/theme/            the Reply theme (GDS default plus two documented accessibility corrections)
src/shell/            AppShell (DiscoveryShell, sidebar, health banner, error boundary), nav destinations
src/routes/           one lazy module per screen
src/api/              fetch client (timeouts, error envelope) and generated response types
src/hooks/            useHealth
src/components/       ErrorBoundary, SkipLink
e2e/                  Playwright specs, service launcher, accessibility helper
```
