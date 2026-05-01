# {reply} — Multiple mailboxes (reply#21)

Local-first support for **more than one mail source** (several Gmail OAuth connections and/or several IMAP accounts) is staged in **`settings.json`** without breaking the existing flat **`imap`** / **`gmail`** blocks used by the worker today.

## Schema (`~/Library/Application Support/reply/settings.json`)

| Field | Type | Description |
| :--- | :--- | :--- |
| `mailAccounts` | array | Optional list of additional accounts. Each entry: `id`, `label`, `provider` (`imap` \| `gmail_oauth`), `enabled`, `imap` (host, user, …), optional `gmailAccountRef` for future multi-Gmail splits. |
| `defaultMailAccountId` | string \| null | Which `mailAccounts[].id` is preferred for **send** once the composer supports picker (initial delivery: storage + API only). |

The **primary** IMAP and Gmail OAuth settings remain at the top level (`imap`, `gmail`). **`sync-mail.js`** runs primary IMAP first, then each enabled **`mailAccounts[]`** row with `provider: "imap"` (skipping a duplicate host+user vs primary). Per-account UID state lives under `~/Library/Application Support/reply/imap_sync_state.json` → `accounts.<id>.mailboxes`.

## API

- **`GET /api/settings`** — returns masked `mailAccounts` (IMAP passwords as `hasPass` / `passHint` only) and `defaultMailAccountId`, via `maskSettingsForClient`.
- **`POST /api/settings`** — accepts `mailAccounts` and `defaultMailAccountId`. Empty `imap.pass` on an existing `id` preserves the stored secret (same pattern as top-level IMAP).

## Security

Secrets for extra accounts use the same encryption path as other settings fields when you extend `SENSITIVE_FIELDS` for nested paths in a later patch. Until then, treat extra IMAP passwords like the primary `imap.pass` (encrypted at rest when written through the hub).

## UI (follow-up)

Settings page: add/remove rows, pick default, choose mailbox when sending email — tracked as polish on top of this storage layer.
