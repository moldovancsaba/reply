# Design system: how Reply Core uses GDS

All user interface in Reply Core comes from the Sovereign Squad **General Design System** (`@sovereignsquad/gds`, https://github.com/sovereignsquad/general-design-system), consumed from GitHub Packages (needs a token with `read:packages`, see [core/ui/README.md](../core/ui/README.md)). This document is the contract between the app and GDS: the rules, what is composed from what, the local parts, the theme corrections and the workarounds, so each can be removed when GDS changes.

## Rules

1. **Only GDS.** No other component library, no direct Mantine imports (a lint rule enforces it), no hand-written visual CSS, no raw colours or sizes (a lint rule flags them). Spacing, colour, radius and typography come from GDS tokens through GDS layout components.
2. **Accessibility is the bar.** Every screen passes the GDS accessibility gate (`@sovereignsquad/gds-a11y`, axe plus contrast) in light, dark and at 375 px; state is never conveyed by colour alone; focus is visible and managed; dialogs trap and restore focus. The gate is real: `createGdsA11yTest` only scans if axe is in the page, so the app's helper adds it and asserts it ([CORE_UI.md](CORE_UI.md)).
3. **Every data surface has loading, empty, error and success states** from `StateBlock`/`InlineAlert`, and works with 0, 1 and many items.
4. **A pattern GDS lacks is requested upstream** and, meanwhile, composed locally from GDS parts and listed below.

## What each screen is made of

| Screen | GDS parts |
|---|---|
| Shell | `DiscoveryShell`, `SidebarNav*`, `GdsBadge`, `InlineAlert`, `SemanticButton` |
| Inbox list | `DataToolbar`, `TextInput`, `ChoiceChip`, `AccentPanel` (cards), `Anchor`, `GdsGeneratedAvatar`, `GdsRelativeTime`, `GdsColumnGrid`, `OverflowContainer` |
| Conversation | `AccentPanel` (message panels), `GdsBadge`, `CardTitle` (day headings), `SemanticButton`, `InlineAlert`, `StateBlock` |
| Profile | `SectionPanel`, `TextInput`, `Textarea`, `StatusBadge`, `GdsGeneratedAvatar`, `SearchableSelect` |
| Search | `TextInput`, `ChoiceChip`, `GdsRemovableTag`, `AccentPanel`, native `<mark>` for highlights |
| Sources | `SectionPanel`, `StatusBadge`, `BannerNotice`, `InlineAlert`, `SemanticButton` |
| Reply box | `Radio`, `Select`, `Textarea`, `Switch`, `SemanticButton`, `GdsDialog` |

## Local parts (not in GDS)

| Part | Where | Why |
|---|---|---|
| `TimelineEntry` | `core/ui/src/patterns/` | person-to-person, channel-aware message entry; proposed upstream (general-design-system#945, item 11) |
| `ConfirmPanel` | `core/ui/src/components/` | a `GdsDialog` with Cancel and a labelled confirm button, because `ConfirmDialog` has an unnamed close button |
| `Notices` | `core/ui/src/shell/` | renders the GDS notification provider's active notices as inline alerts (GDS only ships a full "Notifications" panel) |
| `LogRegion`, `SkipLink`, `ErrorBoundary` | `core/ui/src/` | a `role="log"` wrapper (GDS layout parts take no `role`), the skip link, the error boundary |

## Theme

`core/ui/src/theme/replyTheme.ts` applies two accessibility corrections through `createPublicBrandTheme({ overrides })`: dimmed text darkened in light mode (`gray-6` `#4b5563`) and lightened in dark mode (`dark-2` `#c1c2c5`) so it passes contrast on the tinted message panels, and primary shade 7 in light mode for the active navigation label. Reported upstream as general-design-system#944. Remove the overrides when GDS defaults pass.

## Workarounds and findings (general-design-system#944, #945)

| Finding | Workaround |
|---|---|
| `GdsSplit` never splits (its inline `grid-template-columns` beats its own media query) | `GdsColumnGrid` with `GdsColumnGridItem` spans |
| `ConfirmDialog`: unnamed close button (axe `button-name`), fixed "Confirm" label | `GdsDialog` via `ConfirmPanel` |
| `GdsDialog` throws without an `OverlayManagerProvider` | the provider wraps the routes in `App.tsx` |
| toasts have no renderer | `Notices` |
| `SearchableSelect`'s `ariaLabel` breaks axe label-in-name | no `ariaLabel`; a descriptive placeholder |
| `GdsBox`/stacks/text accept neither `role` nor `id` | small wrapper components, `component="output"`/`"search"`, plain `div` for anchors |
| `SemanticButton` takes its text from `label`, children are dropped | always pass `label` |
| `GdsInline` with `justify` end/start collapsed a content-sized child at phone width | `GdsColumnGrid` spans |
| no highlight component | native `<mark>` |
| `PageHeader` has no compact variant | the Inbox header has no subtitle |
| `createGdsA11yTest` navigates by itself and silently passes without axe | init script plus an assertion that axe is present |

## Adding or changing UI

Compose from GDS parts first; check the table above; run `npm --prefix core/ui run verify` (lint rules, types, unit tests, build, bundle budget, accessibility gate); add the screen's states to the Playwright specs in light, dark and 375 px; document it in [CORE_UI.md](CORE_UI.md). If GDS lacks something, open an issue in the GDS repository, compose a local part meanwhile, and add it to the tables here.
