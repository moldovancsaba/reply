# User guide

Reply Core puts your messages and emails in one place. Everything stays on your Mac. For the first-time set-up (permissions, the first import) see [CORE_FIRST_RUN.md](CORE_FIRST_RUN.md); this guide is for using it.

## Opening it

Double-click **{reply}** on your Desktop, or run `node scripts/reply-core start` in the `core` folder. It opens in Safari at `http://127.0.0.1:45511`. With the start-at-login agent installed it is already running when you log in.

## The inbox

How much you see depends on the window: wide (about 1,280 px and more) shows three columns, the list, the conversation and the profile; a tablet-sized window shows the list and the conversation, and the profile opens in the conversation's place; a narrow window shows one thing at a time with a way back.

The left column lists the people you talk to, newest first. Each card shows the name, the last message (and who wrote it), when, the channel of the last message and how many messages you have exchanged on each channel. A **"3 new"** tag means three messages arrived since you last looked.

- **Search names** and the **channel buttons** (All, iMessage, Email, WhatsApp) narrow the list. The address bar keeps your choice, so reloading or going back keeps it. **Clear filters** resets it.
- **Load more** at the bottom of the list shows older conversations.
- A source that is not working is named above the list, so a short list is not mistaken for "no messages".

## A conversation

Click a person. The middle column is **one timeline across all channels**: each message shows its channel (icon and name), who wrote it and when; messages you sent sit on the right in violet, messages you received on the left in grey. Day headings separate days. Emails are marked **Email summary** because Mail only stores a summary of the text. Attachments are listed by name and size; they cannot be opened here.

- **Load earlier messages** goes back in time without losing your place.
- **Only iMessage / Only Email / Only WhatsApp** at the top of the conversation filter it to one channel.
- When new messages arrive while you are reading older ones, a **"N new messages"** button appears at the bottom.
- In a WhatsApp group each message shows who wrote it.
- Mail you send to yourself shows once (the sent copy and the received copy are one message).

## The profile

The right column (**Hide profile** / **Show profile** in the conversation header; on a narrow window use the **Profile** link) is everything Reply Core knows about the person:

- **Photo:** the picture from your address book (a letter avatar when there is none).
- **Address book:** name parts, nickname, organization, job title, department, birthday, web addresses, postal addresses (read-only, from your Contacts).
- **How to reach them:** every phone number, email address and WhatsApp number, with how many messages and when the last one was.
- **Activity:** how many messages, how many you received and sent, since when, when you last heard from them and last wrote to them, the last 30 days, and the split by channel.
- **Details you add:** profession, company, relationship, LinkedIn address, intro. Press **Save**.
- **Notes:** write a note and press **Add note**; delete one with **Delete note** (it asks first and cannot be undone). Notes and details stay on this Mac and survive a rebuild of the database.
- For a **group**, the profile lists its **members** instead (admins first, how much each wrote, a link to the person's own conversation when there is one).

## Search

**Search** in the sidebar finds a word or phrase in every message and email. Type at least two characters and press Enter (it also searches as you type from three). The matching words are highlighted; click a result to open that conversation. The line "Searched iMessage, Email and WhatsApp" says what was covered, and a notice appears if a source could not be searched.

## Two entries for the same person

Reply Core never merges people by itself. In a profile, **Might be the same person** proposes entries with the same name or the same number on another channel: **Review merge** opens the usual confirmation, **Not the same** hides the proposal for good. If you see the same person twice (say a phone number and an email address), open one, go to **Merge** at the bottom of the profile, search for the other and confirm. The dialog says exactly what moves ("Move 1 handle and 2 messages from … into …?"). After a merge a notice offers **Undo** for 15 seconds; later you can undo from **Merge history** in the profile. If you merged in several steps, undo the last one first.

## Replying

The **Reply** box is under the conversation.

1. Choose the channel under **Send through** (only channels the person really has an address for are offered; the default is the channel of the last message). If a channel has several addresses you can pick one. For email there is a **Subject**.
2. Write the message. The line under the box says who it goes to and how.
3. Optional: **Attach files** (iMessage and Email; up to 5 files, 20 MB each, 25 MB together). A file alone is enough. Press **Send**. Reply Core shows exactly what will be sent and to whom; confirm with **Send**. It is sent through Messages, Mail or WhatsApp on your Mac and appears in the conversation a few seconds later. You can switch the confirmation off with **Ask me before sending**.
4. Prefer to review in the app yourself? **Open in {App} instead** opens Messages, Mail or WhatsApp with your text ready, and you press send there. **Copy text** copies it.

Your unfinished text is kept for this browser session. The first time you send, macOS asks for permission ("{reply} wants to control Messages" and so on); use **Allow {reply} to send** (on the Sources screen or in the Reply box) if it does not. WhatsApp also needs Accessibility. Details: [CORE_SENDING.md](CORE_SENDING.md). If the box says "The message may have been sent", check the conversation before sending again.

What you may see afterwards:

- **Messages:** it is sent in the background; the file (if any) arrives first, then the text.
- **Mail:** comes to the front for a moment while it sends, then you are back in the app you were in.
- **WhatsApp:** WhatsApp opens the chat, Reply Core presses Return for you and you are taken back. Reply Core then looks in WhatsApp's own data for your message: **"Sent through WhatsApp"** means it arrived in the right chat; **"Pressed Send in WhatsApp. It could not be confirmed that the message arrived"** means it could not check (give {reply} Full Disk Access, see [CORE_PERMISSIONS.md](CORE_PERMISSIONS.md)), so look at the chat; **"The message went to a different chat"** means exactly that, so open WhatsApp and check it. WhatsApp cannot be given files from here; use **Open in WhatsApp instead** for those.

## Suggested replies (optional)

If you have set up a local model (Ollama, see [CORE_DRAFTING.md](CORE_DRAFTING.md)), **Suggest a reply** writes a draft from the recent conversation. It is marked **AI-generated draft. Review before sending.** Choose **Insert** (you pick *Replace my text* or *Add below my text* if you already wrote something), **Regenerate** or **Discard**. Nothing is inserted or sent until you say so. If drafting is off, the button is greyed out and the line next to it says how to turn it on.

## Sources

**Sources** shows each connected app, whether it is working, how many messages it has given, and what to do if it needs attention (the steps and the link to the right System Settings page). **Sync now** reads a source again; **Recheck** asks macOS again after you grant a permission. A **Not synced yet** source has not imported anything. A **Sending** panel at the top has **Allow {reply} to send** (it asks macOS to let {reply} control Messages, Mail and System Events), and a blocked Contacts source gets **Allow {reply} to read Contacts**; choose Allow in the macOS window that opens, then **Recheck**.

## When something looks wrong

| You see | Do |
|---|---|
| The inbox is empty | Open **Sources**: a blocked source (usually a missing permission) is the usual cause |
| "Reply Core is not running" at the top | Double-click **{reply}** or run `node scripts/reply-core start` |
| A source says **Needs your attention** | Follow its steps, then **Recheck** |
| Sending says "not allowed to control Messages/Mail" | **Allow {reply} to send** (on Sources or in the Reply box), choose Allow in the macOS windows, try again |
| WhatsApp says it "could not be confirmed", or "went to a different chat" | Look at the chat in WhatsApp; for confirmation give {reply} Full Disk Access ([CORE_PERMISSIONS.md](CORE_PERMISSIONS.md)) |
| "A draft is already being written" | Another person's suggestion is still being written; wait a moment (asking again for the same person takes over) |
| A name is a number | WhatsApp has no name for that person; add them to your address book |
| Anything else | `node scripts/reply-core status` and `node scripts/reply-core logs`; see [KNOWN_ISSUES.md](KNOWN_ISSUES.md) |

## Accessibility

The app is built to be used with the keyboard and a screen reader, in light and dark, and from 375 px wide up; the automatic checks run on every change. A person has not yet gone through it with VoiceOver: the checklist is [ACCESSIBILITY_CHECKLIST.md](ACCESSIBILITY_CHECKLIST.md). Safari tabs to every control only with Option held (Safari's own default, not this app's).

Backups run once a day on their own; restore and rebuild are described in [CORE_OPERATIONS.md](CORE_OPERATIONS.md).
