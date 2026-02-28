<p align="center">
  <img src="public/favicon.svg" alt="{reply} logo" width="140" />
</p>

<h1 align="center">{reply} Workspace</h1>
<p align="center"><strong>A unified aggregation proxy and outbound transport engine for iMessage, WhatsApp, Mail, and LinkedIn.</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v1.0.0-2563EB?style=for-the-badge" alt="Version">
  <img src="https://img.shields.io/badge/platform-macOS-0F172A?style=for-the-badge" alt="Platform">
  <img src="https://img.shields.io/badge/transport-OpenClaw%20%7C%20AppleScript-0EA5E9?style=for-the-badge" alt="Transports">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#installation">Installation</a> •
  <a href="#run-modes">Run Modes</a> •
  <a href="#architecture-and-tools">Architecture & Tools</a>
</p>

## Product Overview

`{reply}` is your unified communication bridge. It continuously scrapes, polls, and listens to webhook events from all your major messaging platforms, vectors them into an embedded [LanceDB](https://lancedb.github.io/lancedb/) engine, and ties directly into your local offline intelligence engine (`{hatori}`). 

Capabilities:
- **WhatsApp Webhook Ingress**: Works exclusively via `OpenClaw` hardware routing.
- **iMessage Scraping**: Scans `~/Library/Messages/chat.db` every few minutes.
- **Unified RAG Search**: Semantically search your multi-channel history.
- **AI Suggest & Magic**: Hooks up to `23572` (Hatori) to draft, refine, and plan messages.

---

## Quick Start

```bash
git clone https://github.com/your-org/reply.git
cd reply/chat
npm i
cd ..
make run
```

Open:
- UI Workspace: `http://127.0.0.1:45311/`
- API Health: `http://127.0.0.1:45311/api/health`

---

## Installation

### Prerequisites

Required:
- **macOS** (mandatory for AppleScript and iMessage database reads)
- **Node.js 18+**
- **Full Disk Access** granted to your Terminal / IDE to read `~/Library/Messages/chat.db`.

External Dependencies:
- **OpenClaw** (for WhatsApp routing)
- **`{hatori}`** (for AI summarization and suggestions)

### 1. Environment Bootstrap

Copy the example file:
```bash
cd chat
cp .env.example .env
```
Ensure your ports line up with what your ecosystem expects (default: `PORT=45311`). Make sure `REPLY_USE_HATORI=1` is set if you want the magic wand UI to work.

### 2. Configure Hardware Routing

In the UI (`http://127.0.0.1:45311/settings.html`), configure the backend. `{reply}` uses hardcoded, resilient routing. For WhatsApp, it explicitly delegates out to OpenClaw. Make sure your gateway is linked:

```bash
openclaw channels login --channel whatsapp
```

---

## Run Modes

### 1) Background Scripts (Recommended)

To run {reply}, {hatori}, and OpenClaw all in tandem, use the provided wrapper:

```bash
make run
make stop
make status
```
Logs are automatically written to `/tmp/reply-hub.log`.

### 2) macOS Menu Bar App

We supply a compiled Swift app identical to Hatori's to quickly observe database ingestion status and jump to specific URLs.

```bash
make install-reply-toolbar
make run-reply-toolbar # or open ~/Applications/reply-toolbar.app
```

### 3) Foreground Debugging

```bash
cd chat
npm run dev
```

---

## Architecture and Tools

### Egress (Sending)
- **WhatsApp**: Hard-wired to use `openclaw message send --target <b64> --message <text> --channel whatsapp`.
- **iMessage**: Generates localized AppleScripts pointing to `1st service whose service type is iMessage`.
- **Email**: Attempts `sendGmail()` via OAuth if configured; otherwise, launches `Mail.app` via GUI scripting.
- **LinkedIn**: Generates payload via `{hatori}`, assigns to `pbcopy` (clipboard), and spawns `open https://www.linkedin.com/messaging/`.

### Ingress (Receiving)
- `{reply}` background workers recursively parse `chat.db` for Apple messages.
- OpenClaw pushes `http://127.0.0.1:45311/api/channel-bridge/inbound` events whenever a WhatsApp/Viber/Discord/Signal device routes a message.
- Newly ingested events trigger `persistHatoriNbaForInbound`—a silent call to `{hatori}` to generate Next Best Actions (NBA) and drafts before you even open the UI.

## Troubleshooting

- **WhatsApp failing with "refactor pending" or AppleScript errors**: We recently scrubbed all legacy desktop automation fallbacks from the system. Ensure you are exclusively using `OpenClaw` and running the correct CLI.
- **iMessage Missing?**: Go to System Settings -> Privacy & Security -> Full Disk Access -> Give Terminal / VSCode permissions.
- **Hatori Magic is red?**: Hatori operates on `http://127.0.0.1:23572`. Check the Menu Bar App to see if it is down.

## Contributing
1. Create a feature branch.
2. Run standard NPM linting.
3. Keep hardware dependencies abstracted behind `interfaces/`.

## License
Provided "as-is" for individual localhost ecosystem routing.
