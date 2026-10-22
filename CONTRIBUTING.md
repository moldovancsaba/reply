# Contributing to Reply Core

Reply Core is the code in [`core/`](core/). The previous generation of the project lives in [`legacy/`](legacy/README.md) and is not developed any more.

## Setup

```bash
cd core
npm install
npm --prefix ui ci                                              # the UI uses the GDS design system from the public npm registry
bash helper/build.sh                                             # the native helper (Xcode command line tools)
node scripts/reply-core start                                    # run it: docs/CORE_FIRST_RUN.md
```

Node 20.17 or newer. Everything runs on macOS; the service needs no network.

## Before you open a pull request

```bash
cd core
npm run verify            # lint (no warnings), Swift tests, Node tests, UI lint/types/tests/build/bundle budget/Playwright accessibility
node scripts/audit.js     # documentation and repository audit
npm run verify:release    # everything above plus the launcher smoke test, as one table
```

All of it must pass with **zero warnings**. The same checks run in CI.

## Rules that are not negotiable

1. **UI only from the GDS design system** (`@sovereignsquad/gds`): no other component library, no hand-written visual CSS, no raw colours. A pattern GDS lacks is requested in the GDS repository and, meanwhile, composed locally from GDS parts and listed in [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md). Accessibility is mandatory: every screen passes the GDS accessibility gate in light, dark and at 375 px.
2. **Privacy:** message text, names, addresses and phone numbers never reach logs, metrics or error messages (ids, counts, channel and error code only). Other apps' databases are opened read-only. Merging people and sending messages are explicit user actions only.
3. **No personal data in the repository**, ever, including test data (synthetic only) and screenshots.
4. **Documentation changes with the code**: update the matching document in [docs/](docs/README.md), [CHANGELOG.md](CHANGELOG.md) and, for a known limitation, [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md). `node scripts/audit.js` rejects obsolete wording, broken links and a changelog that does not match the version.
5. **Tests:** every behaviour has a test that fails if it breaks; user interface behaviour is tested in a real browser against the real service (Playwright, `core/ui/e2e`). Tests never send a real message (the service is started with `REPLY_CORE_SEND_DRIVER=fake`).
6. **Migrations are forward-only** and checksummed (`core/src/storage/migrations`); user data (notes, profile fields, read state, merges) must survive `rebuild`.

## Commits and pull requests

Small, focused pull requests; the description says what changed, how it was verified and what was not verified. Commit messages are in the imperative.
