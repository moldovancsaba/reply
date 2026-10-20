# Reply Core: macOS permissions

Reply Core reads other apps' data. macOS grants access to the **program that starts Reply Core**: the signed **{reply}** app (`~/Applications/{reply}.app`) when you start it with `reply-core start` or the login agent (`reply-core build-app` builds it), otherwise the Terminal or whatever launches `node`. The helper inherits it.

| Source | What is read | Permission | Where |
|---|---|---|---|
| iMessage | `~/Library/Messages/chat.db` | Full Disk Access | System Settings > Privacy & Security > Full Disk Access |
| Apple Mail | `~/Library/Mail/V*/MailData/Envelope Index` | Full Disk Access | same |
| Contacts | the address book (Contacts framework) | Contacts | prompted on first use (`doctor` shows `needs_consent` until then); System Settings > Privacy & Security > Contacts |
| WhatsApp Desktop | `ChatStorage.sqlite` in its container | Full Disk Access | same (connector: `whatsapp`, opt-in; macOS may also ask once whether Reply Core can access data from other apps) |
| IMAP passwords | the login keychain (through the helper) | Keychain access | macOS may ask once to let `reply-core-helper` use the saved item; choose Always Allow ([CORE_SECURITY.md](CORE_SECURITY.md)) |

## Sending

| What | Permission | Where |
|---|---|---|
| Sending through Messages and Mail | Automation: {reply} may control Messages and Mail | System Settings > Privacy & Security > Automation |
| Sending through WhatsApp | Automation of System Events, and Accessibility for {reply} | Automation, and Privacy & Security > Accessibility |

macOS shows {reply} in those lists only after it has asked: use **Allow {reply} to send** in the Reply box (or run `open -a ~/Applications/{reply}.app --args --consent-send`). Details: [CORE_SENDING.md](CORE_SENDING.md).

## Checking

```bash
core/helper/bin/reply-core-helper doctor
```

Prints one state per source (`ok`, `needs_consent` for Contacts, `permission_denied`, `source_missing`, `source_locked`, `schema_unsupported`; `--only imessage|mail|contacts` checks one, sources not checked show `skipped`) and never reads message content. WhatsApp is checked by the service itself (see the Sources screen), not by `doctor`. `permission_denied` means macOS refused: grant the permission to the launching app, restart it, and run `doctor` again. `source_missing` means the app has no data yet (for example no Mail account is configured).


## Notes

- Reply Core never changes system settings; the grant is always your own action.
- Revoking a permission later turns that source `blocked`; data already imported stays readable.
- The helper opens every source read-only and has no network code.
- `GET /api/status` ([CORE_STATUS.md](CORE_STATUS.md)) and the Sources screen show these states with the same recovery steps, from one catalog.
