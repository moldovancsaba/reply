# User Guide: {reply}

## Start / Stop
1.  Navigate to the `{reply}` folder in Finder.
2.  Double-click **`Launch Reply.command`** (foreground dev-style run from `chat/`), **or** install the background hub with `make run` from the repo root (see [LOCAL_MACHINE_DEPLOYMENT.md](LOCAL_MACHINE_DEPLOYMENT.md)).
3.  A terminal window will open when using the `.command` launcher.
4.  The UI is usually `http://localhost:45311/` (or the next port if `45311` is busy — use the URL printed in the terminal or check `~/Library/Logs/reply/hub.log`).

To stop: keep the `make run` terminal open while using the app, and run `make stop` when you want the hub down (details in [LOCAL_MACHINE_DEPLOYMENT.md](LOCAL_MACHINE_DEPLOYMENT.md)).

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
*   **Composer** includes a channel dropdown (`iMessage`, `WhatsApp`, `Email`, plus draft-only bridge channels when available).
*   The buttons `🎤 Mic`, `✨ Magic`, `💡 Suggest` are visible only in the feed view.

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
If Gmail is connected, selecting **Email** in the composer sends via the Gmail API automatically.

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
*   **Setup:** see [LOCAL_MACHINE_DEPLOYMENT.md](/Users/Shared/Projects/reply/docs/LOCAL_MACHINE_DEPLOYMENT.md) for OpenClaw login and gateway notes.

---

## Troubleshooting
*   **Already running:** The launcher detects this and asks if you want to restart.
*   **Permission denied:** `chmod +x "Launch Reply.command"`.
*   **Sync says it failed:** in current builds, a successful trigger only means the background sync started. If the source still degrades, inspect that specific connector’s permissions or health card state.
