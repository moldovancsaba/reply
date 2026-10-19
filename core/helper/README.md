# reply-core-helper

Standalone Swift command-line helper that exports iMessage, Apple Mail and Apple Contacts as versioned NDJSON for the Reply Core connectors. It only reads; it has no network code and writes nothing except stdout/stderr.

```bash
cd core/helper
bash build.sh                       # swift build -c release, copies bin/reply-core-helper, records bin/reply-core-helper.sha256
bin/reply-core-helper --version     # 1.0.0 schema=1
bin/reply-core-helper doctor        # per-source access state, no content read (--only imessage|mail|contacts checks one)
bin/reply-core-helper imessage --db ~/Library/Messages/chat.db --after 0 --limit 500
bin/reply-core-helper mail --root ~/Library/Mail --after 0 --limit 500
bin/reply-core-helper contacts [--after <offset>] [--limit <n>]
```

Requires macOS 15+ and the Xcode Swift toolchain. `swift test` runs the unit tests.

## Contract

stdout is NDJSON only (one object per line); stderr is human diagnostics without message content. Every line validates against [`schema/v1.json`](schema/v1.json) (`schemaVersion: 1`). The Node side rejects any other major version.

| `type` | Meaning |
|---|---|
| `message` | One iMessage or mail message. Common fields: `source`, `providerMessageKey`, `account`, `threadKey`, `counterpartHandle` (raw, unnormalized), `isFromMe`, `tsMs` (UTC epoch ms, `0` = no usable date), `subject?`, `text`, `attachments[]`. iMessage adds `isGroup`, `isReaction`, `service`. Mail adds `sender`, `to[]`, `mailboxKind`, `accountLabel`. |
| `contact` | `contactId` (Contacts identifier), `displayName`, `phones[]`, `emails[]`. |
| `cursor` | Always the last line. `cursor` is `{rowid}` (imessage, mail) or `{offset}` (contacts), `exported`, `more`. |
| `warning` | `undecodable_text` with a count (an `attributedBody` that could not be decoded; the message is still exported with empty text). |

Paging: pass the returned `rowid` as `--after`; repeat while `more` is true. A page with no new rows returns only the cursor and never moves it backwards.

### Exit codes

| Code | `code` | Meaning |
|---|---|---|
| 0 | | ok |
| 2 | usage | bad arguments |
| 10 | `permission_denied` | macOS refused access (Full Disk Access / Contacts consent) |
| 11 | `source_missing` | database or folder not found |
| 12 | `source_locked` | database busy after one retry (200 ms) |
| 13 | `schema_unsupported` | required tables/columns are missing |
| 20 | `internal` | anything else |

`doctor` prints `{"contacts":..,"imessage":..,"mail":..}` with values `ok`, `permission_denied`, `source_missing`, `source_locked`, `schema_unsupported` and, for contacts only, `needs_consent` (the user has not been asked yet; the first `contacts` export shows the macOS prompt, so this is not a failure). It exits with the code of the first problem.

## Behaviour worth knowing

- **Reactions** (`associated_message_type >= 2000`) are exported with `isReaction: true`; the connector decides to skip them.
- **Group chats** (`chat.style = 43`): `isGroup: true`, `threadKey` is the chat guid, `counterpartHandle` is the sender (empty for messages you sent).
- **Attachments**: metadata only. When there is no text, `text` is `[Attachment: name]` / `[Attachments: n]`.
- **Mail**: reads the Envelope Index of the highest `V*` folder. `text` is Mail's stored *summary*, not the full body. Deleted rows are not exported; drafts, junk and trash are exported with their `mailboxKind` so the connector can exclude them. Direction: sent mailbox or a sender that sends from a sent mailbox.
- **Contacts**: the Contacts framework has no modification date, so the export is complete on every call (sorted by identifier; with no `--limit`, or `--limit 0`, everything is returned in one call; `--after`/`--limit` page through it) and the service compares fingerprints. The first call from a new host process triggers the macOS consent prompt; `doctor` never prompts.
- **attributedBody**: decoded by a bounds-checked reader of the typedstream layout, not `NSUnarchiver`, because `NSUnarchiver` raises an uncatchable Objective-C exception on truncated blobs. The unit tests check the reader against bytes produced by the real `NSArchiver` for many strings (up to > 64 KB) and against every truncation point of a blob.
- **Read-only**: databases are opened with `SQLITE_OPEN_READONLY`. A test asserts the source file hash and directory listing are unchanged after an export.

## Integrity and trust

`build.sh` writes `bin/reply-core-helper.sha256` next to the binary. The Node wrapper (`core/src/helper`) refuses to run a binary whose SHA-256 differs from that file (`helper_unavailable`). This detects a swapped binary after build; it is not a supply-chain guarantee. `bin/` is git-ignored (a build's hash depends on the toolchain, so it is recorded per build, not committed).

The binary imports no networking symbols (checked by a test with `nm -u`).

## Node API

`core/src/helper/index.js`: `runHelper(args, {signal, timeoutMs=30000})` returns `{records, messages, contacts, warnings, cursor}` or throws `HelperError` (`code`: `permission_denied`, `source_missing`, `source_locked`, `schema_unsupported`, `helper_unavailable`, `timeout`, `internal`; `retryable` is true for `source_locked` and `timeout`). `helperDoctor`, `helperVersion`, `verifyChecksum` are also exported. A hung helper is killed with its whole process group at the timeout.
