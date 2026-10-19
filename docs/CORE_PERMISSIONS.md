# Reply Core: macOS permissions

Reply Core reads other apps' data. macOS grants access to the **process that starts Reply Core** (the Terminal, or whatever launches `node`), and the helper inherits it.

| Source | What is read | Permission | Where |
|---|---|---|---|
| iMessage | `~/Library/Messages/chat.db` | Full Disk Access | System Settings > Privacy & Security > Full Disk Access |
| Apple Mail | `~/Library/Mail/V*/MailData/Envelope Index` | Full Disk Access | same |
| Contacts | the address book (Contacts framework) | Contacts | prompted on first use; System Settings > Privacy & Security > Contacts |
| WhatsApp Desktop | `ChatStorage.sqlite` in its container | Full Disk Access | same (connector: issue #195) |

## Checking

```bash
core/helper/bin/reply-core-helper doctor
```

Prints one state per source (`ok`, `permission_denied`, `source_missing`, `source_locked`, `schema_unsupported`) and never reads message content. `permission_denied` means macOS refused: grant the permission to the launching app, restart it, and run `doctor` again. `source_missing` means the app has no data yet (for example no Mail account is configured).

## Notes

- Reply Core never changes system settings; the grant is always your own action.
- Revoking a permission later turns that source `blocked`; data already imported stays readable.
- The helper opens every source read-only and has no network code.
- The status API and the Sources screen (issues #190 and #202) show these states with the same recovery steps.
