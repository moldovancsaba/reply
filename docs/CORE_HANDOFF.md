# Reply Core Handoff

Status: living document, owned by issue #203; the composer (#205) is its first user.

**Reply Core never sends anything.** A handoff builds a link that opens the right macOS app with your text prefilled; you press send there. This keeps a person in final control and removes the automation permissions and transport failures that sending would need.

## `POST /api/handoff`

```json
{ "contactId": "c_1", "channel": "whatsapp", "text": "See you at 6" }
```

Optional: `handle` (which of the contact's addresses to use), `subject` (email only, max 300 characters). Any other key is `400 invalid_request`.

```json
{ "handoffId": "h_01H...", "action": "open_url", "url": "https://wa.me/36301234567?text=See%20you%20at%206",
  "channel": "whatsapp", "handleLabel": "+36 30 123 4567 (WhatsApp)",
  "note": "Opens WhatsApp with your text. Reply Core does not send it." }
```

`note` is the exact sentence the UI shows after opening the link. The UI must open `url` from a click handler (a user gesture); the service never launches apps.

### Channels and links

| Channel | Reaches | Link |
|---|---|---|
| `imessage` | the contact's phone numbers and email addresses | `sms:<handle>&body=<text>` (opened by Messages) |
| `email` | the contact's email addresses | `mailto:<address>?subject=<subject>&body=<text>` (opened by the default mail app) |
| `whatsapp` | the contact's WhatsApp numbers (`+e164@wa`) | `https://wa.me/<digits>?text=<text>` (opens WhatsApp through the browser) |

Everything is percent-encoded; newlines survive as `%0A`. A test decodes each link back to the exact text for twelve hostile strings (newlines, emoji, `&`, `#`, `%`, quotes, `+`, HTML, URLs, separators).

Group chats and opaque ids have no address, so they can never be a recipient. The recipient is **always** one of the contact's own stored handles of the right kind, never a value taken from the request: a handle that is not this contact's, or is the wrong kind for the channel, is `422 handle_not_owned`.

Without `handle`, the address used is the one in the most recent message on that channel (else the first).

### Long text

If the link would exceed 2,000 characters, or the text is over 1,500 characters, the answer is `"action": "copy_and_open"` and `url` has **no body**: the UI copies the text to the clipboard first, opens the link, and tells the user the text was copied. Text over 10,000 characters is `413 text_too_long`.

### Errors

| Status | `code` | When |
|---|---|---|
| 400 | `invalid_request` | bad channel, non-text `text`, unknown key, missing `contactId`, subject too long |
| 400 | `text_empty` | nothing but whitespace |
| 404 | `contact_not_found` | unknown contact; a merged-away contact adds `details.mergedInto` |
| 413 | `text_too_long` | over 10,000 characters |
| 422 | `no_handle_for_channel` | the contact has no address for that channel; `details.availableChannels` lists what they do have |
| 422 | `handle_not_owned` | `handle` is not the contact's address for that channel |

## Which channels can I reply on?

`GET /api/contacts/:id` includes `replyChannels`: for each usable channel, the contact's addresses with a `default` flag, so the composer never has to guess:

```json
"replyChannels": [ { "channel": "imessage", "handles": [ { "value": "+36301234567", "label": "+36 30 123 4567", "default": true } ] },
                   { "channel": "whatsapp", "handles": [ { "value": "+36301234567@wa", "label": "+36 30 123 4567 (WhatsApp)", "default": true } ] } ]
```

## Audit

Every handoff writes one row to `handoffs` (migration `0006_handoffs.sql`): id, time, contact id, channel, kind of address, text **length**. Never the text, the subject or the address. The log line is `handoff channel= action= textLength=` for the same reason.

## What a handoff does not guarantee

- Whether the message was actually sent: the user may not press send. A sent message appears in Reply Core through the normal connectors after the next sync.
- That the destination app prefills the text. On the macOS version used to develop this, `sms:` is handled by Messages.app, `mailto:` by Mail.app and `https://wa.me/...` by the browser (which then offers to open WhatsApp). Whether Messages fills in the body from an `sms:` link has to be checked by a person on each macOS release: send yourself a test (owner step). If it does not, switch `imessage` to `copy_and_open` in `core/src/handoff/service.js`.
- Which mail app opens `mailto:` links: the system default.
