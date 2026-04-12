<p align="center">
  <img src="public/favicon.svg" alt="{reply} logo" width="140" />
</p>

<h1 align="center">{reply}</h1>
<p align="center"><strong>A unified aggregation proxy and outbound transport engine for iMessage, WhatsApp, Mail, and LinkedIn.</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.5.9-2563EB?style=for-the-badge" alt="Version">
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
- **Knowledge annotation (Ollama, local):** Ingest first, then run **`cd chat && npm run annotate`** (or rely on the **background worker** timer). Tags, summaries, and facts land on each LanceDB row; **`/api/suggest-reply`** returns them on each `snippets[]` item when annotated, and the reply pipeline uses the same enriched text as **`context-engine`** RAG facts. See **[docs/INGESTION.md](docs/INGESTION.md)** and `REPLY_ANNOTATION_*` in **`chat/.env.example`**.
- **Context engine & voice:** Recipient-scoped history and hybrid RAG are assembled in **`chat/context-engine.js`** (see **[docs/CONTEXT_ENGINE.md](docs/CONTEXT_ENGINE.md)**). **Mic** in the hub uses the browser **Web Speech API** to fill the composer; pair with **Suggest** for an AI draft.
- **Alias merge (reversible):** Merging contacts moves channels/notes to the primary and keeps the other SQLite row as an **`primary_contact_id` alias**. The KYC panel lists linked profiles with **Unlink**; APIs: **`GET /api/contacts/aliases?for=`** and **`POST /api/contacts/unlink-alias`** (`aliasContactId`). See **[reply#19](https://github.com/moldovancsaba/reply/issues/19)**.
- **Auto-triage & zero-inbox hints:** Rule file **`chat/triage-rules.json`** drives `triage-engine.evaluate()` — each hit logs **`suggestedActions`** (`reply`, `archive`, `upload`) and **`priority`**. Dashboard shows a **priority queue** plus log columns; **`GET /api/triage-queue`**. See **[reply#24](https://github.com/moldovancsaba/reply/issues/24)**.

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
- UI: `http://127.0.0.1:45311/`
- API Health: `http://127.0.0.1:45311/api/health`

---

## Installation

**Running the full hub on this Mac (LaunchAgent, logs, `.env`, Ollama, iMessage DB permissions, and stability fixes added for local delivery)** is documented in **[docs/LOCAL_MACHINE_DEPLOYMENT.md](docs/LOCAL_MACHINE_DEPLOYMENT.md)**.

### Prerequisites

Required:
- **macOS** (mandatory for AppleScript and iMessage database reads)
- **Node.js 18+**
- **Full Disk Access** granted to your Terminal / IDE to read `~/Library/Messages/chat.db`.

External Dependencies:
- **OpenClaw** (for WhatsApp routing)
- **`{hatori}`** (optional; for AI drafting via the Hatori API). Clone as a **sibling** of this repo and enable `REPLY_USE_HATORI=1` — see **[docs/LOCAL_MACHINE_DEPLOYMENT.md](docs/LOCAL_MACHINE_DEPLOYMENT.md)** (section *Optional — `{hatori}`*) and **[moldovancsaba/hatori](https://github.com/moldovancsaba/hatori)**.

### 1. Environment Bootstrap

Copy the example file:
```bash
cd chat
cp .env.example .env
```
Ensure your ports line up with what your ecosystem expects (default: `PORT=45311`). For Hatori-backed suggest, install the sibling repo and set `REPLY_USE_HATORI=1` (see [LOCAL_MACHINE_DEPLOYMENT.md](docs/LOCAL_MACHINE_DEPLOYMENT.md)); otherwise suggestions use **Ollama** only.

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
Logs are automatically written to `/tmp/reply-hub.log`. **Install details, `.env`, Ollama, iMessage `chat.db` / Full Disk Access, and port behavior** are in **[docs/LOCAL_MACHINE_DEPLOYMENT.md](docs/LOCAL_MACHINE_DEPLOYMENT.md)**.

### 2) macOS Menu Bar App

We supply a compiled Swift app identical to Hatori's to quickly observe database ingestion status and jump to specific URLs. It complements the hub; **service install, health checks, and troubleshooting** still follow **[docs/LOCAL_MACHINE_DEPLOYMENT.md](docs/LOCAL_MACHINE_DEPLOYMENT.md)**. **Build prerequisites and rebuild-after-move** are in **[tools/macos/ReplyMenubar/README.md](tools/macos/ReplyMenubar/README.md)**.

```bash
make install-ReplyMenubar
make run-ReplyMenubar # or open ~/Applications/ReplyMenubar.app
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

### Intelligence Loop
- `{reply}` automatically triggers `{hatori}` draft generation for every inbound message via `background-worker.js`.
- **Annotation Loop**: Every sent message is compared against its original draft. `{reply}` reports outcomes (`sent_as_is` or `edited_then_sent` with diffs) back to `{hatori}` at `POST /v1/agent/outcome` for model fine-tuning.
- **Manual Drafting**: Use "💡 Suggest" for forced regeneration or "✨ Magic" for context-aware refinement via Hatori/Gemini.
- **Background Backfill**: A periodic task runs every 5 minutes to generate missing drafts for older active conversations.

## Troubleshooting

- **Hub exits or LaunchAgent loops; log shows `SQLITE_CANTOPEN`**: The hub is designed to stay up even when Apple’s `chat.db` is missing or blocked; see [docs/LOCAL_MACHINE_DEPLOYMENT.md](docs/LOCAL_MACHINE_DEPLOYMENT.md) (sections 4–5) for Full Disk Access, `REPLY_IMESSAGE_DB_PATH`, and what was fixed in `sync-imessage` / the worker.
- **WhatsApp failing with "refactor pending" or AppleScript errors**: We recently scrubbed all legacy desktop automation fallbacks from the system. Ensure you are exclusively using `OpenClaw` and running the correct CLI.
- **iMessage Missing?**: Go to System Settings -> Privacy & Security -> Full Disk Access -> Give Terminal / VSCode permissions.
- **Hatori Magic is red?**: Hatori operates on `http://127.0.0.1:23572`. Check the Menu Bar App to see if it is down.
- **Refine / suggestions need Ollama**: Default local model is `gemma4:e2b` (`ollama pull gemma4:e2b`). Details in [docs/LOCAL_MACHINE_DEPLOYMENT.md](docs/LOCAL_MACHINE_DEPLOYMENT.md).

## Contributing
1. **Track work** in [`moldovancsaba/reply` issues](https://github.com/moldovancsaba/reply) and the [`{reply}` GitHub Project (#7)](https://github.com/users/moldovancsaba/projects/7). See [docs/PROJECT_MANAGEMENT.md](docs/PROJECT_MANAGEMENT.md).
2. Create a feature branch.
3. Run standard NPM linting.
4. Keep hardware dependencies abstracted behind `interfaces/`.

## License
Provided "as-is" for individual localhost ecosystem routing.
