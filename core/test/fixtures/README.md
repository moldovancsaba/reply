# Source fixtures

Deterministic, anonymous replicas of the third-party databases Reply Core reads, so connectors can be built and tested in CI without a real Mac profile. Test-only code: production code never imports from here.

```bash
cd core
npm run fixtures -- --seed 42 --out /tmp/rc-fixtures [--imessage 200] [--mail 200] [--whatsapp 200] [--contacts 25] [--corpus 2000] [--force]
```

Prints a JSON map of paths on stdout (timing on stderr); exits non-zero on failure. Refuses a non-empty output directory unless `--force`.

| Output | Replicates | Basis |
|---|---|---|
| `imessage/chat.db` | Apple Messages: `message`, `handle`, `chat`, `chat_message_join`, `chat_handle_join`, `attachment`, `message_attachment_join` | columns read by `legacy/app/reply-app/Sources/ReplyHelper/IMessageExport.swift`, macOS 26 |
| `mail/V10/MailData/Envelope Index` | Apple Mail: `messages`, `mailboxes`, `addresses`, `subjects`, `summaries`, `recipients` | columns read by `MailExport.swift`, macOS 26 |
| `whatsapp/ChatStorage.sqlite` | WhatsApp Desktop: `ZWAMESSAGE`, `ZWACHATSESSION`, `Z_METADATA` | columns read by `legacy/chat/sync-whatsapp.js` |
| `contacts/contacts.ndjson` | Output of the native helper `contacts` command | Native helper issue (#186), section 9 |
| `corpus.ndjson` | `NormalizedMessage` lines for storage/performance tests (streams to disk) | Storage issue (#184) |

Only the columns Reply Core reads are replicated. Real-device drift is caught only by the manual real-data check in each connector issue.

## Determinism

Everything derives from `--seed` through a mulberry32 PRNG (`rng.js`). Each source has its own derived stream, so changing one count never changes another source's data. Dates are anchored to a fixed reference time (2026-10-01), never the wall clock. A test scans the generators for `Math.random` and `Date.now`.

## Edge cases present in every build

- **iMessage:** body only in `attributedBody` (`text` NULL; encoder verified byte-for-byte against the real `NSArchiver`), tapback/reaction rows (`associated_message_type` 2000), group chat with 3 members, attachment-only messages, `iMessage` and `SMS` services, nanosecond and second-based Apple timestamps, handles with and without `+`, email-based handles.
- **Mail:** three accounts, sent and received, messages with no subject, a sent message with 20 recipients, `deleted = 1` rows, HTML-only messages (no summary), and Drafts/Junk/Trash mailboxes that connectors must exclude.
- **WhatsApp:** individual chats, a group chat (`@g.us`), media-only messages, system rows (`ZMESSAGETYPE = 10`), a `status@broadcast` row, Core Data epoch timestamps, a `Z_METADATA` identity.
- **Contacts:** a person with 3 phones and 2 emails, two different people with the same display name, a contact with no handles, a non-Latin name, an organization-only contact, two people sharing one landline.

## Privacy

All identifiers are synthetic: phones in the fictional `+1 212 555 0xxx` range, emails on `example.com`, `example.org`, `example.net`. A test asserts this and, when `REPLY_CORE_FIXTURE_DENYLIST` (comma-separated) is set, that none of the listed real identifiers appears. Nothing generated is committed.
