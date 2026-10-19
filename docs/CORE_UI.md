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

All GDS presets I tried (`high-contrast`, `colorblind-safe`, `royal`, `skyline`, ...) fail the same dimmed-text check, so the findings were filed as [general-design-system#944](https://github.com/sovereignsquad/general-design-system/issues/944) (together with a documentation trap in the accessibility package, below). Remove the overrides when GDS ships defaults that pass.

Known, not failing: GDS `StateBlock` renders its title as an `h3`, which axe reports as a moderate heading-order warning after the page's `h1`. The gate fails on serious and critical findings.

## The accessibility gate (how it works, and a trap)

`npm run test:e2e` runs `createGdsA11yTest` from `@sovereignsquad/gds-a11y` on `/inbox` (empty, populated, no match, error, blocked source), `/inbox/c_123`, `/search`, `/sources` and an unknown route, in light and dark, plus the keyboard order of the shell (skip link, then the three navigation links), a 375 px phone viewport, a 320 px / reduced-motion check, and the service-down state. Serious and critical findings fail.

**Trap:** `createGdsA11yTest` navigates to the route itself, which discards any script added before the call, and its scan returns "no violations" when `axe` is not in the page. The GDS documentation example adds axe first and would therefore pass without scanning anything. `e2e/a11y.ts` adds axe as an init script (present after every navigation) and asserts it is in the page, so the gate cannot pass silently.

For a state reached by interaction (the 375 px drawer, the service-down alert) use `expectAccessibleNow`, which scans the page as it is without navigating.

## Inbox (conversation list)

`/inbox` and `/inbox/:contactId` (`src/routes/Inbox.tsx`, `src/routes/inbox/`). One row per contact from `GET /api/contacts`, newest first, 30 per page; **Load more** follows the opaque `nextCursor` (no infinite scroll, so keyboard users are never moved). The list refreshes every 60 s and when the tab regains focus.

- **URL is the state:** `?q=anna&channel=email`. Typing is debounced 250 ms and replaces the history entry; a channel change adds one (Back undoes it). Unknown channels fall back to "All"; the search is capped at 200 characters.
- **Row:** a link to `/inbox/:id`. Its accessible name is its visible text (name, relative time, preview, channel, per-channel counts) so the label always matches what is shown; the avatar is decorative. The time is a `<time dateTime title>` with the full date on hover.
- **States:** loading, empty with no filters ("No conversations yet", link to Sources), empty with filters ("No conversations match", Clear filters), error (message plus the request reference, Try again), load-more in progress and load-more failure. A source that is blocked or in error is named above the list (`SourceNotice`, from `/api/status`) so a short list is not mistaken for "no messages".
- **Layout:** 1280 px: list (4 columns) and detail (8 columns) side by side; below 62 em only the list, or only the detail with a "Back to conversations" link. The layout switch is a `matchMedia` hook, so exactly one tree is in the DOM.
- **Detail pane:** the thread timeline (next section).

GDS notes found while building it: `GdsSplit` never splits (its inline `grid-template-columns` beats its own media query), so a `GdsColumnGrid` is used; `SemanticButton` takes its text from the `label` prop, not children; `GdsBox` has no `role` prop and `Text` components neither.

## Thread timeline

`ThreadPane` (`src/routes/thread/`) fills the detail pane of `/inbox/:contactId` from `GET /api/contacts/:id` and `/messages` (newest page first, shown oldest to newest). The channel filter is `?thread=imessage|email|whatsapp` (kept apart from the list's own `channel`).

**Composition contract (`src/patterns/TimelineEntry.tsx`)**, built only from GDS primitives, memoised, keyed by message id:

| Part | Rule |
|---|---|
| Container | `role="log"` named "Messages with {name}" (a tiny local component, because GDS layout primitives take no `role`) |
| Entry | `<article>` named "{Channel} from {name}, {full date and time}" or "{Channel} sent by you, ...". Direction: received on the leading side, sent on the trailing side, plus the words "You" / the name |
| Channel | `GdsBadge` with icon and text, never colour alone |
| Email | the subject as a label line; "Email summary" when `isSummary` (the text is Mail's stored summary) |
| Attachments | "Attachment: name, type, size (not downloadable)" |
| Text | rendered as text only (React escapes it), no auto-linking, so hostile content such as `<img onerror>` stays visible text |
| Day separators | real headings (`h3`) labelled Today, Yesterday or the full date |

**States:** loading; empty with no messages ("No messages with this person yet"); empty for a filtered channel (with Show all channels); error with the request reference and Try again (loaded messages stay visible when only a refresh fails); Load earlier in progress / failed (alert at the top, content kept); contact merged away or unknown (link to Inbox and, when the API says so, to the contact it was merged into); filtered channel's source blocked (warning with a link to Sources).

**Scroll rules** (no custom scroll container, so it works with whatever scrolls the page): opening a thread (or changing the filter) scrolls to the newest message; **Load earlier messages** keeps the previously first message at the top of the view; every 30 s (tab visible) the newest page is refetched, and new messages are followed only if the reader is at the bottom, otherwise a "N new messages" button appears and is announced politely through an `output` element. Focus is never moved by updates.

**Promotion:** `TimelineEntry` is a candidate GDS pattern (person-to-person, channel-aware message entry); a request in `sovereignsquad/general-design-system` should be opened after delivery.

GDS notes: `GdsInline` with `justify` end/start collapsed the entry to about 8 px at 375 px width, so alignment uses a 12-column `GdsColumnGrid`; `SectionTitle`/`CardTitle` set the heading level with `order`, not `component`; `GdsBox` takes no `id` (a plain wrapper `div` carries the anchor id).

## Contact profile and merge

`/inbox/:contactId/profile` (`src/routes/profile/ProfilePane.tsx`), reached from "Profile and merge" in the thread header. It is a page in the detail pane on every width (the issue allowed a drawer on desktop; a page keeps one code path and works at 375 px).

- **Profile:** display name, where the contact came from (address book / created automatically / created by you), per-channel message counts, handles grouped by channel in labelled lists with the handle kind.
- **Merge:** a searchable picker (`SearchableSelect`, loads `GET /api/contacts?q=&includeEmpty=true`, excludes the current contact, "No contacts match") opens a confirmation that restates both names and counts: "Move 1 handle and 2 messages from {source} into {this contact}?". Nothing is sent before the confirmation. The Merge button is loading and disabled while the request runs (one request even on a double click), the dialog stays open on failure with a plain explanation (`mergeErrorText`: `cannot_merge_self`, `contact_not_found`, `handle_conflict` with the blocking handles, `merge_already_reverted`), and there is no optimistic update. On success contacts, contact, thread and history queries are refreshed, a notice with **Undo** shows for 15 s and the app opens the kept contact's conversation.
- **Undo:** from the notice (it opens the profile with `?undo=<merge id>`, which opens the undo confirmation) and from **Merge history** (newest first; merges not yet undone have an Undo button; undone ones say "undone"). Undo always asks first, naming both people. A conflict (an earlier merge must be undone first) is explained in the dialog.
- **Empty history:** "No merges yet." is plain text, not an error.

Local components added because GDS lacks them (or has a defect, see below): `src/components/ConfirmPanel.tsx` (a `GdsDialog` with Cancel and a labelled confirm button) and `src/shell/Notices.tsx` (shows the GDS notification provider's active notices as inline alerts: success is a polite status, errors are alerts; GDS only ships a full "Notifications" panel). `App.tsx` wraps the routes in `GdsToastProvider` and `OverlayManagerProvider`.

GDS findings: `ConfirmDialog` renders an unnamed close button (axe `button-name`, critical) and cannot relabel its confirm button, so `GdsDialog` is used; `GdsDialog` needs an `OverlayManagerProvider` (without it the screen crashes); `SearchableSelect`'s `ariaLabel` must contain its visible text (axe `label-content-name-mismatch`), so none is set and the placeholder is descriptive; dialogs fade in, so contrast checks must wait for the transition.

## Search

`/search?q=&channel=&contactId=` (`src/routes/Search.tsx`, `src/routes/search/`). Everything is in the URL, so a search can be reloaded, bookmarked and stepped back through.

- **Input:** a labelled field inside a `search` landmark. Enter searches from 2 characters; typing searches by itself after 3 characters (300 ms pause, replaces the history entry). Under 2 characters shows plain helper text, never an alert. Channel filter chips ("Only Email" ...) and a removable "In conversation with {name}" tag when `contactId` is set.
- **Results:** a flat list in the service's ranking, each a link to `/inbox/:contactId` (name, channel badge with icon, relative time with the exact date on hover, snippet). Cursor **Load more**. A count is announced politely (`output`) and "Searched iMessage, Email and WhatsApp" always names what was searched.
- **Snippets:** the service marks matches with `\u0001` and `\u0002` (never HTML). `parseSnippet` (`src/lib/snippet.ts`) is total (a stray or unterminated mark is dropped or plain text) and the highlight is a native `<mark>` element built from text segments, so message content can never become markup. GDS has no highlight component; `<mark>` carries the semantics, not just colour.
- **States:** initial guidance (info, not an error), too short, loading ("Searching ..."), results, no results ("No results for 'x' in iMessage and Email.", with Clear filters when filtered), error with request reference and Try again (earlier results stay with a warning when only a refresh fails), load-more failure, and per-channel notices: "{Channel} is not connected, so it was not searched." (never synced, no messages) and "{Channel} is not syncing, so recent messages may be missing." (blocked or error), each linking to Sources.
- **Stale answers:** the query is part of the react-query key, so changing it cancels the request in flight (abort signal) and a late answer can never replace a newer one; previous results stay (marked busy) until the new ones arrive.

## Sources

`/sources` (`src/routes/Sources.tsx`, pure mapping in `src/routes/sources/viewModel.ts`). One `SectionPanel` per connector from `GET /api/status`; the page subtitle says "All sources are connected", "2 of 5 sources need attention" or "Your sources are getting ready".

| State | Badge (text + icon) | Sentence | Recommended action |
|---|---|---|---|
| `ok` | Connected (success) | Messages are up to date. | Sync now |
| `syncing` | Syncing (info) | Importing messages now. "Imported N messages so far" (live region, at most one update per 5 s) | none (button shows "Syncing...", disabled) |
| `never_synced` | Not synced yet (neutral) | Nothing has been imported from this source yet. | Sync now |
| `error` | Problem, will retry (warning) | the service's message; "Next attempt ..." | Sync now |
| `blocked` | Needs your attention (danger) | the service's message, then the **ordered** recovery steps | Recheck |

Each panel also shows the message count, "Last success ...", the next check and, for IMAP, one line per account. **Recheck all** and the per-panel **Recheck** call `POST /api/status/recheck`; a source that was blocked or failing and is now ok is announced once ("iMessage is connected.").

- **Deep links:** a recovery step's link is rendered only if it starts with `x-apple.systempreferences:` (anything else, such as `javascript:`, is shown as plain step text), with a descriptive name ("Open Full Disk Access settings").
- **Sync now:** disabled while a run is in flight or the source is syncing; `409 already_running` counts as success (no error); other errors (for example `423 blocked`) appear as an error notice.
- **Polling:** `GET /api/status` every 3 s while any source is syncing, every 30 s otherwise, paused while the tab is hidden.
- **Infrastructure:** a storage error or a missing/modified helper is an error alert above the panels, with the storage recovery steps.
- **First run:** when at least one source exists and none is `ok` with no messages imported, the first visit to `/inbox` in a page load redirects to `/sources` (replace) and the page shows "Connect a source to get started". It never redirects again in that page load, and the banner is gone as soon as one source is ok.
- **Other states:** loading ("Checking your sources"), status unreachable (error with Try again; the shell banner covers the service itself being down), no sources enabled (guidance).

## Composer (reply handoff)

`src/routes/thread/Composer.tsx`, under the timeline of `/inbox/:contactId`. **Reply Core never sends**: the composer asks the service for a link ([CORE_HANDOFF.md](CORE_HANDOFF.md)) and opens it from the click, so Messages, Mail or WhatsApp opens with the text ready and the person presses send there.

- **Recipient and app are always visible before the action:** "To {name} through {channel} ({address}). Reply Core opens {App} with your text; you press send there. Reply Core never sends anything itself." and the primary button is named for the app ("Open in Messages / Mail / WhatsApp").
- **Channel:** a labelled radio group (arrow keys move between options) listing only the channels in `replyChannels`, each with its address. The default is the channel of the newest message (until the person or a saved draft chooses); a contact with several addresses on one channel gets an address select.
- **Text:** a labelled multi-line field with a character count described by `aria-describedby`; over 1,500 characters the hint becomes "Long messages will be copied to the clipboard instead of prefilled." (not an error). The field is read-only while the request runs, so the text cannot change after it was sent to the service. Secondary action: **Copy text**.
- **Opening:** `openFromGesture` clicks a temporary `rel="noopener noreferrer"` anchor inside the click handler (a user gesture); web links open in a new tab, `sms:` and `mailto:` hand over to the app. `copy_and_open` copies the text first and says so (or says it could not copy). The notice carries the service's exact note and a "Click here to open {App} again" link as the fallback when the browser blocks the link.
- **States:** idle; no channels ("No way to reach this person from here yet", link to the profile); submitting (loading, disabled); error (an alert with plain wording, focus moves to it, the text is kept, Try again when retryable); success (notice, text cleared, draft removed, focus back in the field); over limit.
- **Drafts:** saved per contact in `sessionStorage` (`rc.draft.<contactId>`, 400 ms after typing, "Draft saved" shown), restored after navigation or reload within the session, removed after a handoff. Storage that is missing or throws just means no draft is kept. Leaving the thread never shows a dialog; the saved draft makes it unnecessary.
- **Privacy:** the text only goes to the loopback API in the request body; it is never logged by the UI.

## Adding a screen

1. Replace the route's `Placeholder` with the screen (a lazy module in `src/routes/`), composed from GDS only.
2. Define loading, empty, error and success (and blocked or stale where the data can be) with `AsyncSurface` / `StateBlock`; test zero, one and many.
3. Add the route to the accessibility specs for each state it can show, in light and dark, and at 375 px.
4. Keyboard: every control reachable and operable, focus managed after actions, no focus stolen by updates.
5. Add the screen's section to this document.

## Budget and checks

`npm run check:bundle` fails if the JavaScript exceeds 250 KB gzipped (currently about 193 KB, almost all of it the shared design-system chunk).
