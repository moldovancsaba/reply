# Reply Core

**One inbox for your messages, on your Mac.** Reply Core shows iMessage, Apple Mail, Contacts and, optionally, WhatsApp and IMAP in one place: one conversation per person across every channel, a profile with everything you know about them, search, and replies sent through the apps you already use. Everything stays on your machine: the service listens on `127.0.0.1` only and nothing goes to a cloud.

- **One timeline per person** across iMessage, email and WhatsApp, with new-message counts and WhatsApp groups with their members.
- **A contact profile**: address-book details, every number and address, activity facts, your own details and notes.
- **Search** across every message and email, with highlights.
- **Send** from the app (Messages, Mail, WhatsApp) after a confirmation, or open the reply in the app instead; an optional local model can suggest a draft.
- **Private by construction**: other apps' data is only read; merging people and sending are always your decision; nothing personal reaches a log; one signed app holds the macOS permissions.

## Run it

```bash
cd core
npm install
GITHUB_TOKEN=<token with read:packages> npm --prefix ui ci    # the UI uses the GDS design system from GitHub Packages
node scripts/reply-core start                                  # opens Safari at http://127.0.0.1:45511
```

macOS 14 or newer, Node 20.17 or newer, Xcode command line tools (for the native helper and the signed `{reply}` app). The first run opens on **Sources**, which walks you through the macOS permissions: [docs/CORE_FIRST_RUN.md](docs/CORE_FIRST_RUN.md). Daily use: [docs/USER_GUIDE.md](docs/USER_GUIDE.md).

## Documentation

[docs/README.md](docs/README.md) is the map. Start with the [user guide](docs/USER_GUIDE.md), the [architecture](docs/CORE_ARCHITECTURE.md) and the [technical design](docs/TECH_DESIGN.md); see [known issues](docs/KNOWN_ISSUES.md) and the [changelog](CHANGELOG.md).

## Quality gates

```bash
cd core
npm run verify            # lint (no warnings), Swift and Node tests, UI checks and the GDS accessibility gate
npm run verify:release    # everything above, the launcher smoke test, the repository and documentation audit, the dependency audit
```

## Repository layout

| Path | What |
|---|---|
| [`core/`](core/README.md) | Reply Core: the service (`src`), the web app (`ui`), the native helper (`helper`), the signed host app (`app`), scripts and tests |
| [`docs/`](docs/README.md) | Documentation |
| [`legacy/`](legacy/README.md) | The previous generation of the project, archived; not developed |

## Contributing, security, license

[CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [MIT License](LICENSE)
