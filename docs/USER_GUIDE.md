# User Guide: Reply System Launcher

## How to Start the System
1.  Navigate to the `reply` folder in Finder.
2.  Double-click the file named **`Launch Reply.command`**.
3.  A terminal window will open (this is the "engine").
4.  Your default web browser will automatically open to `http://localhost:3000` (or `http://localhost:3001` if port 3000 is already in use — use the URL printed in the terminal).

## UI Settings
*   Click the **gear icon** in the sidebar header to open Settings.
*   Channel cards on the dashboard also include a **⚙️** button for channel-specific configuration.

## WhatsApp Send (Automation)
*   **Prerequisites:** WhatsApp Desktop installed + logged in **and running**, and macOS **Accessibility** permission granted to the process running the server (System Settings → Privacy & Security → Accessibility).
*   **Optional:** Set `WHATSAPP_APP_NAME` if your app name is not `WhatsApp` (e.g. `WhatsApp Beta`).
*   **Behavior:** Best-effort UI automation; if sending fails, {reply} will show an error and offer a clipboard fallback.

## How to Stop the System
1.  Simply close the terminal window that opened.
2.  The system will stop running provided no other background processes were started manually.

## Troubleshooting
*   **"System seems to be already running":** The launcher will detect this and ask if you want to restart. Press any key to restart, or just close the window if you want to keep the existing session.
*   **"Permission Denied":** Verify that the file is executable. Open Terminal and run: `chmod +x "Launch Reply.command"`.
