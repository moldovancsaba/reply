# {reply} — App Navigation & File Map

This document answers: **“Where is X in the UI?”** and **“Where is X in the code?”**

## UI Navigation

### Dashboard
* Open: click the dashboard icon in the sidebar header (or call `window.selectContact(null)`).
* Purpose: system health + manual sync + per-service configuration cogs.

### Feed (per contact)
* Open: click a contact in the sidebar list.
* Purpose: read the thread, write replies, pick channel (`iMessage` / `WhatsApp` / `Email`).
* Feed-only buttons: `🎤 Mic`, `✨ Magic`, `💡 Suggest`.

### Settings
* Open: click the gear icon in the sidebar header (calls `window.openSettings()`).
* Purpose: configure connectors (IMAP/Gmail), worker interval, and per-service settings via the filter.

### Profile pane (KYC / Local Intelligence)
* Visible on feed view; hidden on dashboard to maximize space.
* Purpose: edit contact profile, accept/decline AI suggestions, manage Local Intelligence.

## Code Map (most common files)

### UI (static)
* `chat/index.html` — UI layout (sidebar / main / profile pane / settings page).
* `chat/css/global.css` — design tokens + shared component styles.
* `chat/css/app.css` — app-specific layout and visuals.

### UI logic (modules)
* `chat/js/app.js` — app boot + event wiring.
* `chat/js/contacts.js` — sidebar list + selecting dashboard/feed.
* `chat/js/messages.js` — thread rendering + send logic.
* `chat/js/dashboard.js` — health dashboard cards + sync actions.
* `chat/js/settings.js` — settings page + per-service filter behavior.
* `chat/js/kyc.js` — profile pane (channels/suggestions/Local Intelligence).

### Server (Node)
* `chat/server.js` — all HTTP endpoints + static file serving.
* `chat/settings-store.js` — local settings read/write + masking for UI.

### Mail connectors
* `chat/gmail-connector.js` — Gmail OAuth connect + sync + send.
* `chat/sync-imap.js` — IMAP mail sync.
* `chat/sync-mail.js` — mail sync orchestration (prefers Gmail → IMAP → Apple Mail).

### Background worker
* `chat/background-worker.js` — unified poll loop (iMessage/WhatsApp + optional mail) + intelligence pipeline.

## SSOT (Work Tracking)
* Project Board: https://github.com/users/moldovancsaba/projects/1
* Issues live in: `moldovancsaba/mvp-factory-control`
* Do not create/manage issues in product repos (e.g. `moldovancsaba/reply`).

