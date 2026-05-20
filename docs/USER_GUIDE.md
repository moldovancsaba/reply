# User Guide: {reply}

**Doc freshness:** 2026-05-20

## Start / Stop
1.  Navigate to the `{reply}` folder in Finder.
2.  Double-click **`Launch Reply.command`**, run `make run`, or launch the native shell with `make run-app` from the repo root (see [LOCAL_MACHINE_DEPLOYMENT.md](/Users/Shared/Projects/reply/docs/LOCAL_MACHINE_DEPLOYMENT.md)).
3.  A terminal window will open when using the `.command` launcher.
4.  The UI is usually `http://localhost:45311/` (or the next port if `45311` is busy — use the URL printed in the terminal or check `~/Library/Logs/reply/hub.log`).
5.  Health is available on both `/api/health` and `/api/system/health`.

To stop: keep the `make run` terminal open while using the app, and run `make stop` when you want the hub down (details in [LOCAL_MACHINE_DEPLOYMENT.md](/Users/Shared/Projects/reply/docs/LOCAL_MACHINE_DEPLOYMENT.md)).

---

## Where to Find What (UI Map)

### Sidebar (left)
*   Click a contact to open the **Feed** view for that person.
*   Click the dashboard icon to return to the **Dashboard**.
*   Click the **gear icon** to open **Settings**.
*   Use the **Search contacts** box to filter by name/handle/phone/email.

### Dashboard (home)
*   Shows system health cards (iMessage/WhatsApp/Notes/Email).
*   Use the **sync** icon on each card to trigger a manual sync in the background.
*   Use the **⚙️** icon on a card to configure that specific service.

### Feed (chat)
*   Messages for the selected contact.
*   Sent messages render on the right. Received messages render on the left.
*   The thread preloads the oldest 20 and newest 20 messages when you open a conversation.
*   Longer histories load progressively in the background so the workspace stays responsive.
*   **Composer** only shows reply/send channels that are allowed for the active conversation.
*   If no channel is allowed for that conversation snapshot, send stays disabled and the UI says so explicitly.
*   The buttons `🎤 Mic`, `✨ Magic`, `💡 Suggest` are visible only in the feed view.
*   Drafting is `{trinity}`-first. If the local drafting runtime stalls, `{reply}` can fall back to a bounded local draft instead of freezing the workspace.

### Profile (right pane)
*   Contact profile fields + channels + AI suggestions + Local Intelligence.
*   Hidden automatically on the Dashboard to maximize space.

---

## Settings (Full Page)
Settings is a full page in the main area (same space as the Dashboard).

### General Settings
*   Email connector settings (IMAP + Gmail OAuth)
*   Background worker global poll interval

### Service Settings
Use either:
*   The **⚙️** on a Dashboard card, or
*   The **“Configure a service”** buttons at the top of Settings

Service settings include:
*   Background worker quantity limits per channel
*   Channel appearance (emoji + bubble colors)

---

## Email (Gmail OAuth)
If **Email** is an allowed channel for the current conversation and Gmail is connected, selecting **Email** sends via the Gmail API automatically.

*   Connect in Settings → Gmail (OAuth).
*   Set **Sync scope**:
    *   **Inbox + Sent** (default)
    *   **All Mail** (excludes Spam/Trash)
    *   **Custom query** (Gmail search syntax, e.g. `label:finance OR from:foo@bar.com`)
*   Redirect URI should match the actual local hub port, usually:
    *   `http://localhost:45311/api/gmail/oauth-callback`

---

## WhatsApp Send
*   **Primary path:** OpenClaw-backed transport.
*   **Behavior:** `{reply}` uses the local OpenClaw path when healthy. If the transport is unavailable, `{reply}` surfaces a runtime error rather than pretending the send succeeded.
*   **Channel safety:** WhatsApp only appears in the composer when the active conversation snapshot is allowed to reply on WhatsApp.
*   **Setup:** see [LOCAL_MACHINE_DEPLOYMENT.md](/Users/Shared/Projects/reply/docs/LOCAL_MACHINE_DEPLOYMENT.md) for OpenClaw login and gateway notes.

---

## LinkedIn Ingest
*   **Primary ingest mode:** browser bridge.
*   **Behavior:** LinkedIn events are normalized through the local bridge route and should appear in the workspace without blocking on slow persistence.
*   **If persistence is busy:** the event can be queued briefly and replayed by the background worker.
*   **Health:** LinkedIn state appears under both the dashboard health surface and `/api/system/health`.

---

## Troubleshooting
*   **Already running:** The launcher detects this and asks if you want to restart.
*   **Permission denied:** `chmod +x "Launch Reply.command"`.
*   **Sync says it failed:** in current builds, a successful trigger only means the background sync started. If the source still degrades, inspect that specific connector’s permissions or health card state.
