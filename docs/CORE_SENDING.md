# Reply Core: sending messages

Status: living document. A handoff ([CORE_HANDOFF.md](CORE_HANDOFF.md)) remains available as "Open in {App} instead".

Press **Send** in the Reply box and the message leaves this Mac through the app you already use for that channel. Nothing goes anywhere else: no cloud, no relay.

| Channel | How it is sent | Permission it needs | Reliability |
|---|---|---|---|
| iMessage | AppleScript tells **Messages** to send to the contact's phone number or email address (iMessage first, then SMS if the person is not on iMessage and your iPhone relays texts) | Automation: {reply} may control Messages | good |
| Email | AppleScript tells **Mail** to make and send a message from your default Mail account (subject starts as "Re: ..." of the last mail) | Automation: {reply} may control Mail | good |
| WhatsApp | opens the chat with the text typed in (`whatsapp://send`), waits until WhatsApp Desktop is in front, then presses Return (key code 36, after a 2.5 s wait for the chat to load) through System Events | Automation: System Events, and **Accessibility** for {reply} | least reliable: it depends on WhatsApp Desktop's window; if WhatsApp does not come to the front, or loses the focus before the key press, nothing is sent. The message must then show up in WhatsApp's database, in that chat, within 15 s (see "Confirming WhatsApp") |

Group chats and people without a phone number or address cannot be a recipient (the Reply box offers only what the contact really has). Attachments cannot be sent; use "Open in {App} instead".

## Safety rules

- **One explicit request per message.** The UI asks first ("Send this message?" with the recipient, channel and the exact text) unless you switch "Ask me before sending" off. There is no automatic, scheduled or bulk sending, and drafts from the optional local model are never sent without you pressing Send.
- **The recipient is always one of the contact's own stored handles** for that channel, never a value from the request (`handle_not_owned` otherwise).
- **Text and recipient are arguments to the script, never part of its source** (`on run argv`), so nothing in a message can change what the script does (tested with a hostile text).
- **Idempotent per message.** Every attempt carries a `clientId`; asking again with the same id returns the first outcome (`replayed: true`) and never sends a second message. A request that failed or whose outcome is unknown cannot be repeated with the same id, and the UI keeps the id only when the answer was lost (timeout, network), so a retry replays instead of duplicating.
- **Unknown outcome is said out loud.** If the app does not answer in time (45 s) the attempt is recorded as `unknown`, the UI says "The message may have been sent: check the conversation" and does not offer a blind retry.
- **Rate limit:** one send at a time and at most 10 a minute (`send_rate_limited`).
- **Audit without content:** one row per attempt in `sends` (time, contact id, channel, kind of address, text length, outcome). Never the text, the subject or the address; the log lines carry the channel, length and outcome only.
- **Off switch:** `REPLY_CORE_SENDING=off` removes the Send button (the reason is shown) and the API refuses (`sending_disabled`). `install-agent` stores the setting in the agent if it is set when you run it.

## Permissions, step by step

macOS lists an app under Automation or Accessibility only after the app asks. The Sources screen has a **Sending** panel with an **Allow {reply} to send** button, and in the Reply box a permission error shows the steps and the same button. It opens {reply} in its permission mode (`{reply}.app --consent-send`, or `POST /api/consent` with `{"kind":"sending"}`, or the older `POST /api/send/consent`, which works only when the service was started from {reply}.app and otherwise answers `501 consent_unavailable`): it launches Messages, Mail and System Events and asks macOS for Automation of each, and for Accessibility. Choose Allow in each macOS window, then press Send again. Afterwards System Settings > Privacy & Security > Automation shows {reply} with Messages, Mail and System Events, and Accessibility shows {reply}. The permission belongs to the signed {reply} app, so it survives rebuilds and Node upgrades.

## Confirming WhatsApp

A key press cannot tell whether WhatsApp sent anything, so after it Reply Core looks in WhatsApp's own database (the WhatsApp connector, read-only) once a second for up to 15 seconds for a message of yours with exactly this text, newer than the send, in the chat of that number:

| Found | Result |
|---|---|
| in that chat | `sent`, `confirmed: true` |
| only in another chat | `whatsapp_wrong_chat` (502), recorded as `failed`; the message went to the wrong chat, check WhatsApp |
| not at all | `send_unconfirmed` (504), recorded as `unknown`: it may have been sent; no blind retry |
| the database cannot be read (permission, schema changed) | `sent`, `confirmed: false`, with the note that arrival could not be confirmed |

The look-up works whether or not the WhatsApp source is switched on for syncing; it needs the same access to WhatsApp's data (Full Disk Access for {reply}). If the message is still not there after 5 seconds the Return key is pressed once more (on an empty message box it does nothing, so nothing is sent twice). Without access to the data nothing can be confirmed and the answer is `sent` with `confirmed: false` and the note "Pressed Send in WhatsApp. It could not be confirmed that the message arrived." The window is also checked a second time right before Return; if WhatsApp lost the focus meanwhile nothing is sent (`whatsapp_not_ready`). The send request therefore takes up to about 15 seconds longer for WhatsApp; the one-at-a-time lock is held meanwhile. Confirmation is tested with fixture databases, not yet with a real WhatsApp send (#256).

## After sending

The sent message reaches the source app's database a moment later. Reply Core reads that source again 3 and 12 seconds after a send, and the conversation refreshes after 4 and 14 seconds, so your message appears in the thread through the normal import (there is no separate "pending" copy).

## Errors

| Code | Meaning | What the UI shows |
|---|---|---|
| `automation_denied` (403) | {reply} may not control the app | steps, link to Automation settings, Allow button |
| `accessibility_denied` (403) | {reply} may not press keys (WhatsApp) | steps, link to Accessibility settings, Allow button |
| `recipient_not_found` (422) | the app could not find the recipient | nothing was sent |
| `whatsapp_not_ready` (502) | WhatsApp did not come to the front in 10 s, or lost the focus before Return | nothing was sent; open WhatsApp and retry |
| `whatsapp_wrong_chat` (502) | the message showed up in another WhatsApp chat | "The message went to a different chat" |
| `send_unconfirmed` (504) | the message did not show up in WhatsApp's database in 15 s | "The message may have been sent" |
| `app_not_running` (502) | the app could not be opened | nothing was sent |
| `send_failed` (502) | the app refused the message | nothing was sent |
| `send_timeout` (504) | no answer in 45 s | the message may have been sent |
| `send_rate_limited` (429) | too many or one in flight | wait a moment |
| `send_in_progress` (409) | the same message is still being sent | wait |
| `already_attempted` (409) | this `clientId` already failed or has an unknown outcome | write it again to send a new one |
| `sending_disabled` (403) | `REPLY_CORE_SENDING=off` | no Send button |
| `invalid_request` (400), `text_empty` (400) | a malformed request, or nothing but whitespace | the Send button never offers it |
| `text_too_long` (413) | over 4,000 characters (subject over 300 is `invalid_request`) | shorten the message |
| `no_handle_for_channel`, `handle_not_owned` (422) | the contact has no such address for that channel | the channel is not offered |
| `channel_not_supported` (422) | no driver for that channel | - |
| `contact_not_found` (404) | unknown or merged-away contact | back to the inbox |
| `consent_unavailable` (501), `consent_failed` (502) | the service is not running from {reply}.app (run `node scripts/reply-core build-app`, then `install-agent`), or the app could not be opened | the Allow button explains it |
