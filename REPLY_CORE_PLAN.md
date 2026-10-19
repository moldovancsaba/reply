# Reply Core: a lighter unified inbox

Status: proposal. No code written. Based on reading the code and docs; the app was not run (`node_modules` not installed, `chat/messages.db` empty).

## Goal

See email, contacts and instant messages in one UI, with one merged timeline per contact regardless of channel, without the weight of the full `{reply}` stack.

## Why the current repo is heavy

- `chat/` is about 47,000 lines of JavaScript; the Swift app adds about 5,900.
- Three runtimes (Node, Swift, Python for `{trinity}`) plus Ollama, LanceDB, local embedding models, OpenClaw (WhatsApp), Playwright and a Chrome extension (LinkedIn).
- Most of the code serves AI drafting, not the inbox: `trinity-*`, `reply-engine.js`, `context-engine.js`, `vector-store.js`, `annotation-agent.js`, `style-analyzer.js`, `draft-learning-store.js`, `kyc-agent.js`, `triage-engine.js`, `training_data.jsonl`.
- Two UIs mid-migration: web (`chat/js`, about 13,800 lines) and native SwiftUI (`app/reply-app`).
- Extra channels outside the core ask: Telegram/Discord/Signal/Viber bridge (`channel-bridge.js`, 913 lines) and the LinkedIn scraper.

## What the inbox needs (already in the repo)

| Need | Existing piece |
|---|---|
| Messages from every channel | `unified_messages`, `unified_message_metadata` (`chat/message-store.js`) |
| One person, many handles | `contacts`, `contact_channels` (`chat/contact-store.js`) |
| Fast conversation list | `conversation_index` (`chat/message-store.js`) |
| Merging people | Manual only (keep this rule) |
| iMessage reader | `app/reply-app/Sources/ReplyHelper/IMessageExport.swift` (decodes `attributedBody`) |
| Apple Mail reader | `app/reply-app/Sources/ReplyHelper/MailExport.swift` (reads local Envelope Index) |
| Gmail / IMAP | `chat/gmail-connector.js`, `chat/sync-imap.js` |
| Contacts | `chat/native/apple-contacts-export.swift`, `chat/ingest-contacts.js` |
| WhatsApp (desktop DB) | `chat/sync-whatsapp.js` |

## Design

1. One process, one SQLite file. Use FTS5 for search. No LanceDB, embeddings, Ollama or Trinity in the core.
2. Read-only connectors: iMessage `chat.db`, email (Gmail API/IMAP, or Apple Mail's local index), Apple Contacts, WhatsApp desktop database.
3. Sending is a handoff: open Messages, Mail or `wa.me` with the text prefilled; the human presses send. No AppleScript or OpenClaw send path.
4. One UI: a single localhost page or menu-bar window. Contact list on the left, merged timeline with channel icons on the right. Native SwiftUI is optional later.
5. Drafting is optional and later: last ~20 messages with a contact sent to a local model (or Claude) in one call. No vector DB or learning loop.

Estimated size: 3,000 to 5,000 lines, about half copied from the pieces above. This is an estimate, not a measurement.

## Phases

### Phase 1: read-only unified timeline
- New SQLite schema: messages, contacts, contact_channels, conversation index.
- Connectors: iMessage, Contacts, email.
- Contact-centric UI with manual merge/unmerge.
- Done when: opening a contact shows iMessage and email in one chronological thread, and search finds text across both.

### Phase 2: WhatsApp
- Add the desktop-database reader (best-effort; unofficial and may break on WhatsApp updates).
- Done when: WhatsApp messages appear in the same timeline for matched contacts.

### Phase 3: send handoff
- Prefilled Messages, Mail and `wa.me` links from the timeline.
- Done when: choosing a channel from a thread opens the right app with the text ready.

### Phase 4: drafting (optional)
- One model call per open thread, shown as an editable suggestion.
- Done when: a draft appears on opening a thread, and nothing is ever sent without approval.

## Cut list (not in the core)

Trinity/Train integration, LanceDB and embeddings, annotation, KYC analysis, style analyzer, draft-learning, triage, training data, the channel bridge, the LinkedIn scraper and Chrome extension, OpenClaw send path, the embedded web UI inside the native shell.

## Risks and caveats

- iMessage and Apple Mail access need macOS Full Disk Access for the host process.
- WhatsApp desktop access is unofficial.
- LinkedIn and Telegram are dropped by design.
- Stripping this repo in place is possible but harder than a clean start (`message-store.js` is 1,163 lines; `server.js` and `routes/messaging.js` are very large and entangled).
- Alternative: a hosted unified inbox (such as Beeper) is fastest, but messages pass through their cloud, which defeats the local-only privacy benefit.
