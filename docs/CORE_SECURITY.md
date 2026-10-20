# Reply Core Security and Secrets

Status: living document, owned by issue #196; other issues add their rules here.

## What Reply Core protects, and how

| Rule | Enforced by |
|---|---|
| The API is loopback only; foreign `Host` and `Origin` values are refused | `core/src/server.js` |
| Message text, handles and names never appear in logs, metrics or errors | log redaction, counts-only log lines, tests that capture logs |
| Other apps' databases are opened read-only | native helper, direct read-only SQLite, IMAP `EXAMINE` only |
| No cloud: conversation text leaves this Mac only if you set a remote model URL on purpose | drafting config refuses non-loopback URLs without `REPLY_CORE_ALLOW_REMOTE_LLM=1` |
| A message is sent only when you press Send, to one of the contact's own handles, once | `core/src/send/service.js`: explicit request per message, handle ownership check, `clientId` idempotency, one at a time, 10 a minute, audit without content, `REPLY_CORE_SENDING=off`; see [CORE_SENDING.md](CORE_SENDING.md) |

## Secrets (IMAP app passwords)

- Stored **only** in the macOS login keychain, as generic-password items with service `reply-core.imap` and the account id as the account name.
- Written and read by the native helper (`helper keychain set|get|delete`). The secret travels on **stdin** (set) and **stdout** (get) and is never a command-line argument, so it never shows up in `ps`. The helper refuses any service that does not start with `reply-core.`.
- `reply-core accounts add-imap` asks for the password with a hidden prompt (or `--password-stdin`); there is no `--password` option.
- The accounts file `REPLY_CORE_HOME/imap-accounts.json` (mode `0600`, written atomically) holds host, port, user, label and folders. **No secret.** A test scans it for the password.
- Tests assert that the password appears nowhere: not in the database, not in `sync_state` or `sync_runs`, not in logs, not in the accounts file, not in CLI output.
- Account ids can be email addresses, so logs carry a short hash (`acct_1a2b3c4d`) instead.
- After the helper binary is rebuilt, its code signature changes and macOS may ask once whether `reply-core-helper` may use the saved item. Choose Always Allow.

## IMAP transport

- Implicit TLS only (`secure: true`, certificate verification on). Port 143 cannot be configured. A server with a self-signed or otherwise untrusted certificate is refused: `add-imap` says the certificate is not trusted and the connector reports `network_unavailable` (it will never accept the certificate).
- Read-only commands only (`EXAMINE`, `UID FETCH`, `LIST`): a test records every command the connector sends and asserts there is no `STORE`, `EXPUNGE`, `APPEND`, `COPY`, `MOVE`, `DELETE` or `SELECT`.
- Timeouts: connect 15 s, greeting 15 s, socket 60 s.

## Revoking

Revoke the app password at your email provider at any time: the account turns `blocked: auth_failed` with the recovery steps in [CORE_STATUS.md](CORE_STATUS.md); imported mail stays. `reply-core accounts remove <id>` deletes the keychain item and the accounts entry; add `--purge` to delete that account's imported messages as well.
