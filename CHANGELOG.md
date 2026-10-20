# Changelog

All notable changes to Reply Core. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). Each release's version is in `core/package.json` and `core/ui/package.json`; `node core/scripts/audit.js` checks that this file's newest release matches.

## [0.2.0] - 2026-10-20

The first release you can live in: profiles, sending, new-message counts, a signed app and a launcher, WhatsApp groups, and a documentation and repository clean-up.

### Added
- **WhatsApp sends are confirmed.** After the key press Reply Core looks for the message in WhatsApp's database (15 s): sent only when it is in the right chat; a message in the wrong chat or one that never shows up is reported (`whatsapp_wrong_chat`, `send_unconfirmed`), and the focus is checked again right before Return.
- **Contact photos.** The address-book thumbnail shows in the profile (shrunk by the helper to at most 256 px, JPEG or PNG up to 48 KB, checked on import; `contact_photos`, migration 0013, `GET /api/contacts/:id/photo`). Address-book notes stay unavailable: Apple restricts them to apps with a special entitlement.
- **Duplicate suggestions.** A profile proposes people with the same name or the same number on another channel (**Review merge** / **Not the same**); nothing merges by itself. (`GET /api/contacts/:id/duplicates`)
- **Permissions from the Sources screen.** A **Sending** panel with **Allow {reply} to send**, and **Allow {reply} to read Contacts** when Contacts is blocked. (`POST /api/consent`)
- **Sending from the app.** A **Send** button in the Reply box sends through Messages, Mail (AppleScript) and WhatsApp Desktop (UI scripting) after a confirmation that shows the recipient and the exact text; "Open in {App} instead" remains. Safeguards: the recipient is always one of the contact's own handles, text is passed to the script as data, one request per message (idempotent by `clientId`), one at a time and 10 a minute, unknown outcomes are reported and never retried blindly, an audit without content (`sends`), `REPLY_CORE_SENDING=off`. ([docs/CORE_SENDING.md](docs/CORE_SENDING.md))
- **Contact profile.** A third column (or a page on a narrow window) with address-book details (name parts, nickname, organization, job title, department, birthday, web and postal addresses), every handle with counts and last message, activity facts (counts, sent/received, since, last heard/wrote, last 30 days, per channel), details you add (profession, company, relationship, LinkedIn, intro) and notes. `GET`/`PUT /api/contacts/:id/profile`, `POST`/`DELETE` notes. Profile fields and notes survive `rebuild` and follow the person when an automatic contact is replaced by an address-book contact.
- **WhatsApp:** group and chat names, group member lists (admins first, messages per member, link to their own conversation), sender names in groups. (`group_members`, migration 0009)
- **New-message counts** per conversation ("3 new"), cleared when you have the conversation open at its newest message. (`read_state`, migration 0012)
- **The signed `{reply}.app`** with the `{r}` icon: the program macOS permissions are granted to (Full Disk Access, Contacts, Automation, Accessibility), with `--consent` and `--consent-send` modes that make macOS list it. `reply-core build-app`.
- **Launcher and login agent:** `scripts/reply-core` (`start`, `stop`, `status`, `open`, `logs`, `build-app`, `install-agent`, `uninstall-agent`), opening Safari by default; rotated service logs (10 MB x 5).
- **Release gate:** `npm run verify:release` (lint, Swift and Node tests, launcher smoke test, UI checks and accessibility, repository audit, dependency audit) and `node scripts/audit.js`.
- Scale check `node scripts/bench.js` (500,000 messages: every read under 15 ms).
- Documents: user guide, technical design, design-system contract, known issues, security policy, contributing guide, documentation index, this changelog; MIT license; CI workflow.

### Changed
- Reply Core now **sends**; the first release was handoff-only. Docs, UI wording and the security rules were updated accordingly.
- Visual pass: the list and the conversation scroll independently, conversations are cards, messages are tinted panels (received grey, sent violet), attachment-only messages read as words, dimmed text passes contrast on the tints.
- Search results are cards; the Sources screen says "people" for Contacts.
- The launch agent runs the signed app (falls back to `node`); it keeps the enabled connectors; `bootstrap` is retried after `bootout`.
- Handoff recipient resolution is shared with sending.
- The previous generation of the project moved to [`legacy/`](legacy/README.md); the plan moved to [docs/CORE_PLAN.md](docs/CORE_PLAN.md); legacy Markdown links no longer contain absolute paths of one machine.

### Fixed
- WhatsApp: a message to a person whose chat WhatsApp files under an `@lid` id was reported as "went to a different chat" although it was sent correctly; the look-up now accepts all the person's phone numbers and `@lid` ids.
- WhatsApp: in a real test the text was typed but not sent, while Reply Core said "sent". It now waits 2.5 s for the chat, presses Return as a key code, presses it once more after 5 s if the message is not in WhatsApp's database, and without access to that database never claims "sent": it says it could not be confirmed.
- The inbox at tablet widths (about 1024 px) squeezed three columns into 160 to 290 px each; the third (profile) column now needs 80 em, and between 62 and 80 em the profile page replaces the conversation.
- WhatsApp group messages named the group as sender; the real member is now used (re-import once after upgrading: `node scripts/reset-cursor.js whatsapp --purge`, service stopped).
- Encoded WhatsApp push names (`+CgAQ…=`) were shown as names (migration 0010 restores the handle on affected automatic contacts).
- A merged-away or unknown contact no longer shows a second, empty profile column.
- Several accessibility findings: unnamed dialog close button, label-in-name mismatches, contrast of dimmed text on tinted panels.

### Security
- Removed personal data (contacts database, message exports, vector stores, built app bundle with a message database) from the repository and the history of every branch (rewritten 2026-10-20), revoked the leaked Google API key, and added ignore rules and an audit that fails on tracked databases, personal files and secrets. GitHub still keeps the old pull-request objects, so the removed files stay fetchable by commit SHA (accepted residual exposure, see [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md)).

## [0.1.0] - 2026-10-19

First release of Reply Core: a local service and web app that shows iMessage, Apple Mail, Contacts, WhatsApp (opt-in) and IMAP in one inbox.

### Added
- Node service (Fastify, loopback only, uniform error envelope, redacted logs) with SQLite storage (forward-only checksummed migrations, WAL, full-text search).
- Native Swift helper for Messages, Mail, Contacts and the keychain (NDJSON, versioned schema, checksum-verified).
- Connector framework (runner, scheduler, retries with backoff, atomic page-and-cursor commits) and connectors for iMessage, Contacts, Apple Mail, WhatsApp and IMAP.
- Identity: handle normalization, address-book import, explicit merge and undo with an audit log.
- Read API (list, conversation, search, cursors, ETags), status API with recovery steps, reply handoff (opens the app with your text), optional local-model reply suggestion (Ollama).
- Backup, restore and rebuild, daily backup, pidfile.
- Web app (React, TypeScript, GDS only): inbox, conversation timeline, search, Sources with first-run flow, composer, draft panel; accessibility gate in light, dark and at 375 px.
