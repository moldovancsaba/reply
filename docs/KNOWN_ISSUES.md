# Known issues and limits

What is not done, what is less reliable than the rest, and which checks need a person with a Mac. Updated with every release; newest information first.

## Sending

- **WhatsApp is the least reliable channel.** WhatsApp Desktop has no sending interface, so Reply Core opens the chat with your text and presses Return once WhatsApp is in front. It needs Accessibility permission for {reply}, and depends on WhatsApp's window. If WhatsApp does not come to the front, or loses the focus before the key press, nothing is sent. The Return key is pressed after 2.5 seconds and once more after 5 more if the message is not there (the first press was lost in a real test: the text was typed but not sent). Afterwards Reply Core looks for the message in WhatsApp's database for up to 15 seconds: it is "sent" only when it shows up in the right chat. If the database cannot be read the message is reported as sent but unconfirmed; if it never shows up the outcome is "unknown"; if it shows up in another chat you are told. This has been tested against fixtures, not yet with a real WhatsApp send (#256). Group chats cannot be sent to from Reply Core.
- **iMessage to someone who is not on iMessage** is sent as SMS only if your iPhone relays text messages to this Mac; otherwise Messages refuses and nothing is sent.
- **Whether Messages prefills the text from an `sms:` link** (the "Open in Messages instead" path) depends on the macOS release and has to be checked by a person on each release.
- **Files can be sent through iMessage and Mail only** (WhatsApp cannot take files from here: use "Open in WhatsApp instead"). The AppleScript for files is compiled in tests but has not been run against real Messages and Mail yet (#256). Attachments in received messages are shown by name, type and size only.
- **A send whose answer is lost** is reported as "may have been sent"; Reply Core never retries it blindly. The sent message appears in the conversation after the next sync, a few seconds later.
- **Real-Mac checks still to do** (the tests use a fake sender, so none of this is covered by automation): one real send per channel after the permissions are granted, and the permission prompts after a macOS upgrade.

## Data sources

- **WhatsApp Desktop's data format is unofficial** and may change with an update; Reply Core stops reading rather than guess (the Sources screen says so).
- **Some WhatsApp group members have no name.** WhatsApp stores no name for people who are neither in your address book nor in a chat with you; they show as numbers.
- **Address-book notes are not imported.** Apple only lets apps read the notes field with a restricted entitlement (`com.apple.developer.contacts.notes`) that Apple has to grant to the developer; Reply Core has none. Notes you write in Reply Core are kept. (Contact photos are imported since 0.2.0.)
- **The first import of a large history takes time** (about 12,000 messages per second on an Apple-silicon Mac, plus the time macOS needs to answer permission prompts).
- **Messages edited or unsent after they were imported are not updated;** reactions are not shown.
- **IMAP** has no OAuth (app passwords only), reads the inbox and sent folders only, and a message deleted at the server stays in Reply Core.

## Permissions

- macOS lists {reply} under Automation, Accessibility and Contacts only after the app has asked; use **Allow {reply} to send** on the Sources screen or in the Reply box (and **Allow {reply} to read Contacts** there when Contacts is blocked) (or `open -a ~/Applications/{reply}.app --args --consent-send`) and `--consent` for Contacts.
- The signed `{reply}.app` uses an Apple Development certificate. Rebuilding it with a different certificate makes macOS treat it as a new app and ask for every permission again.
- If the login agent runs bare `node` (the app could not be built), Full Disk Access belongs to that exact `node` binary and has to be granted again after a Node upgrade.

## Interface

- **Safari is tested through Playwright's WebKit, not Safari itself.** The browser tests run in Google Chrome and in WebKit (Safari's engine, same version as Playwright's build); they have not been run in the Safari app. Known differences: after **Cancel** on a suggested reply Safari may keep the connection open for a while, so suggesting again straight away can answer "A draft is already being written" until the model call ends; and the new-message scroll test cannot run under WebKit's fake clock.
- **Not verified by hand:** screen-reader announcements, forced-colors mode, 200% zoom (the 375 px layout and the colour modes are tested).
- **Design-system workarounds** (`GdsSplit` never splits, `ConfirmDialog` has an unnamed close button, no toast renderer, ...) are listed in [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) and reported upstream in general-design-system#944 and #945; they can be removed when GDS fixes them.
- The page header of Search and Sources is the standard GDS header and takes more room than the Inbox one.

## Operations

- `rebuild` does not carry which conversations you had marked as seen (everything counts as seen afterwards) or the send and handoff audits; it keeps manual merges, profile fields and notes.
- A multi-account source (IMAP) that was running when the service crashed is not reset to idle on the next start (the single-account sources are).
- **Continuous integration** (`.github/workflows/ci.yml`) has not run on GitHub yet; the same commands pass locally (`npm run verify:release`).

## Repository

- **Old commits remain fetchable by SHA on GitHub (accepted by the maintainer, 2026-10-20).** The history of every branch was rewritten and the Google key is revoked, but GitHub keeps the old `refs/pull/*` objects, and only GitHub Support can remove them. The maintainer decided not to contact Support or recreate the repository, so anyone who knows an old commit SHA can still read the removed files. Do not treat the removed personal data as erased. Old clones and forks hold it too. Tracked in issue #255.
