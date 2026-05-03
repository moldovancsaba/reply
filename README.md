<p align="center">
  <img src="public/favicon.svg" alt="{reply} logo" width="140" />
</p>

<h1 align="center">{reply}</h1>
<p align="center"><strong>A unified aggregation proxy and outbound transport engine for iMessage, WhatsApp, Mail, and LinkedIn.</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.5.14-2563EB?style=for-the-badge" alt="Version">
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

`{reply}` is a macOS-first local communication operating system for a single human operator.

It brings inbound communication, contact context, local knowledge, draft generation, and outbound execution into one local product.

At a high level, `{reply}`:

1. ingests communication and context from local and connected sources
2. organizes that around contacts and conversations
3. generates and refines drafts locally
4. helps the operator decide what to do next
5. executes the final action through the correct channel
6. captures feedback and outcomes for future improvement

Canonical product definition:
- [REPLY_OVERVIEW.md](REPLY_OVERVIEW.md)

Capabilities:
- **Unified local workspace**: one operator view across conversations, contact profiles, notes, channels, and local intelligence.
- **Channel aggregation**: iMessage, WhatsApp, email, Notes, Calendar, Contacts, LinkedIn messages, and LinkedIn posts.
- **Unified RAG and contact-aware context**: semantically search and retrieve relevant multi-channel history and local facts.
- **AI Suggest & Magic**: local Ollama-backed drafting and refinement with recipient-aware context.
- **Outbound execution**: send or hand off through iMessage, WhatsApp, email, and LinkedIn.
- **Knowledge annotation (Ollama, local):** Ingest first, then run **`cd chat && npm run annotate`** (or rely on the **background worker** timer). Tags, summaries, and facts land on each LanceDB row; **`/api/suggest-reply`** returns them on each `snippets[]` item when annotated, and the reply pipeline uses the same enriched text as **`context-engine`** RAG facts. See **[docs/INGESTION.md](docs/INGESTION.md)** and `REPLY_ANNOTATION_*` in **`chat/.env.example`**.
- **Context engine & voice:** Recipient-scoped history and hybrid RAG are assembled in **`chat/context-engine.js`** (see **[docs/CONTEXT_ENGINE.md](docs/CONTEXT_ENGINE.md)**). **Mic** in the hub uses the browser **Web Speech API** to fill the composer; pair with **Suggest** for an AI draft.
- **Alias merge (reversible):** Merging contacts moves channels/notes to the primary and keeps the other SQLite row as an **`primary_contact_id` alias**. The KYC panel lists linked profiles with **Unlink**; APIs: **`GET /api/contacts/aliases?for=`** and **`POST /api/contacts/unlink-alias`** (`aliasContactId`). See **[reply#19](https://github.com/moldovancsaba/reply/issues/19)**.
- **Auto-triage & zero-inbox hints:** Rule file **`chat/triage-rules.json`** drives `triage-engine.evaluate()` — each hit logs **`suggestedActions`** (`reply`, `archive`, `upload`) and **`priority`**. Dashboard shows a **priority queue** plus log columns; **`GET /api/triage-queue`**. See **[reply#24](https://github.com/moldovancsaba/reply/issues/24)**.
- **Unified brain (scale-out):** Ingest paths + style profile + **`npm run fingerprint`** status JSON — **[docs/UNIFIED_BRAIN.md](docs/UNIFIED_BRAIN.md)** ([reply#12](https://github.com/moldovancsaba/reply/issues/12)).
- **Multiple mailboxes:** `settings.json` **`mailAccounts[]`** + **`defaultMailAccountId`** on **`GET/POST /api/settings`**; **Email** settings tab to add IMAP rows. **`sync-mail.js`** syncs primary IMAP then each extra account (namespaced LanceDB ids + `imap_sync_state.json`). See **[docs/MULTI_MAILBOX.md](docs/MULTI_MAILBOX.md)** ([reply#21](https://github.com/moldovancsaba/reply/issues/21)).

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

### 1. Environment Bootstrap

Copy the example file:
```bash
cd chat
cp .env.example .env
```
Ensure your ports line up with what your ecosystem expects (default: `PORT=45311`). Suggestions use **Ollama** locally.

### 2. Configure Hardware Routing

In the UI (`http://127.0.0.1:45311/settings.html`), configure the backend. `{reply}` uses hardcoded, resilient routing. For WhatsApp, it explicitly delegates out to OpenClaw. Make sure your gateway is linked:

```bash
openclaw channels login --channel whatsapp
```

---

## Run Modes

### 1) Background Scripts (Recommended)

To run `{reply}` as a managed local service, use:

```bash
make run
make stop
make status
```
Logs are automatically written to `/tmp/reply-hub.log`. **Install details, `.env`, Ollama, iMessage `chat.db` / Full Disk Access, and port behavior** are in **[docs/LOCAL_MACHINE_DEPLOYMENT.md](docs/LOCAL_MACHINE_DEPLOYMENT.md)**.

### 2) Foreground Debugging

```bash
cd chat
npm start
```

---

## Architecture and Tools

### Egress (Sending)
- **WhatsApp**: Hard-wired to use `openclaw message send --target <b64> --message <text> --channel whatsapp`.
- **iMessage**: Generates localized AppleScripts pointing to `1st service whose service type is iMessage`.
- **Email**: Attempts `sendGmail()` via OAuth if configured; otherwise, launches `Mail.app` via GUI scripting.
- **LinkedIn**: Copies the draft to the clipboard and opens `https://www.linkedin.com/messaging/`.

### Intelligence Loop
- `{reply}` generates drafts locally for inbound activity via `background-worker.js`.
- **Manual Drafting**: Use "💡 Suggest" for forced regeneration or "✨ Magic" for context-aware refinement.
- **Background Backfill**: A periodic task runs every 5 minutes to generate missing drafts for older active conversations.

### Product Shape
- **Product shell**: native macOS app at `app/reply-app`
- **Runtime**: local Node hub + managed background worker
- **Storage**: SQLite-backed local stores + LanceDB + app-owned data/log paths
- **Current UI reality**: native product shell with a still-transitional embedded workspace UI while native surfaces continue replacing browser-era ones
- **Theme contract**: shipped day/night surfaces must derive from semantic Constellation theme adapters rather than screen-local hardcoded chrome values

### Native App UI Standards
- `{reply}` is a native app product, not a website.
- Core flows must stay inside the app shell through app chrome, panels, and modals rather than page-style detours.
- Every shipped visual item must be available locally and render offline from app-owned assets.
- Product iconography must use the local shared icon system only.
- Icon sizing and icon-button behavior must be consistent across shell chrome, settings, profile actions, dashboard surfaces, and status controls.
- UI renderers must use explicit visual contracts rather than heuristic string parsing for markup versus asset content.

## Troubleshooting

- **Hub exits or LaunchAgent loops; log shows `SQLITE_CANTOPEN`**: The hub is designed to stay up even when Apple’s `chat.db` is missing or blocked; see [docs/LOCAL_MACHINE_DEPLOYMENT.md](docs/LOCAL_MACHINE_DEPLOYMENT.md) (sections 4–5) for Full Disk Access, `REPLY_IMESSAGE_DB_PATH`, and what was fixed in `sync-imessage` / the worker.
- **WhatsApp failing with "refactor pending" or AppleScript errors**: We recently scrubbed all legacy desktop automation fallbacks from the system. Ensure you are exclusively using `OpenClaw` and running the correct CLI.
- **iMessage Missing?**: Go to System Settings -> Privacy & Security -> Full Disk Access -> Give Terminal / VSCode permissions.
- **Refine / suggestions need Ollama**: Default local model is `gemma3:1b` (see `chat/.env.example` for supported tags). Details in [docs/LOCAL_MACHINE_DEPLOYMENT.md](docs/LOCAL_MACHINE_DEPLOYMENT.md).

## Contributing
1. **Track work** in [`moldovancsaba/reply` issues](https://github.com/moldovancsaba/reply) and the [`{reply}` GitHub Project (#7)](https://github.com/users/moldovancsaba/projects/7). See [docs/PROJECT_MANAGEMENT.md](docs/PROJECT_MANAGEMENT.md).
2. Create a feature branch.
3. Run standard NPM linting.
4. Keep hardware dependencies abstracted behind `interfaces/`.

## License
Provided "as-is" for individual localhost ecosystem routing.
