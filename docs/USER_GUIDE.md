# User Guide: {reply}

## Start / Stop
1.  Navigate to the `{reply}` folder in Finder.
2.  Double-click **`Launch Reply.command`**.
3.  A terminal window will open (this is the local server).
4.  Your browser opens to `http://localhost:3000` (or `http://localhost:3001` if port 3000 is in use — use the URL printed in the terminal).

To stop: close the terminal window.

---

## Where to Find What (UI Map)

### Sidebar (left)
*   Click a contact to open the **Feed** view for that person.
*   Click the dashboard icon to return to the **Dashboard**.
*   Click the **gear icon** to open **Settings**.
*   Use the **Search contacts** box to filter by name/handle/phone/email.

### Dashboard (home)
*   Shows system health cards (iMessage/WhatsApp/Notes/Email).
*   Use the **sync** icon on each card to trigger a manual sync.
*   Use the **⚙️** icon on a card to configure that specific service.

### Feed (chat)
*   Messages for the selected contact.
*   **Composer** includes a channel dropdown (`iMessage`, `WhatsApp`, `Email`).
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
*   Redirect URIs (if your server runs on a different port):
    *   `http://localhost:3000/api/gmail/oauth-callback`
    *   `http://localhost:3001/api/gmail/oauth-callback`

---

## WhatsApp Send (Automation)
*   **Prerequisites:** WhatsApp Desktop installed + logged in **and running**, and macOS **Accessibility** permission granted to the process running the server (System Settings → Privacy & Security → Accessibility).
*   **Optional:** Set `WHATSAPP_APP_NAME` if your app name is not `WhatsApp` (e.g. `WhatsApp Beta`).
*   **Behavior:** Best-effort UI automation; if sending fails, {reply} will show an error and offer a clipboard fallback.
*   **Status:** Still flaky on some WhatsApp UI states; treat as “best effort” until `mvp-factory-control#196` is closed.

---

## Troubleshooting
*   **Already running:** The launcher detects this and asks if you want to restart.
*   **Permission denied:** `chmod +x "Launch Reply.command"`.
