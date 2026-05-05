# Contributing to `{reply}`

`{reply}` is a local-first macOS communication workspace. Contributions must preserve three product rules:

1. the primary operator shell is native macOS
2. live drafting behavior is owned by `{trinity}`
3. transport execution, approval, and operator workflow are owned by `{reply}`

And one identity rule:

4. contact merge and unmerge are explicit user-owned actions only

## Before You Change Code

1. Read [README.md](/Users/Shared/Projects/reply/README.md).
2. Read [docs/CODING_STANDARDS.md](/Users/Shared/Projects/reply/docs/CODING_STANDARDS.md).
3. Read [docs/ARCHITECTURE.md](/Users/Shared/Projects/reply/docs/ARCHITECTURE.md).
4. If your change touches drafting or policy flow, also read [docs/TRINITY_INTEGRATION_SPINE.md](/Users/Shared/Projects/reply/docs/TRINITY_INTEGRATION_SPINE.md).

## Local Setup

Install core dependencies:

```bash
git clone <your-fork-or-origin>
cd /Users/Shared/Projects/reply/chat
npm install
```

Install the sibling `{trinity}` runtime:

```bash
cd /Users/Shared/Projects/trinity
uv sync --dev
```

For full local setup, see [docs/LOCAL_MACHINE_DEPLOYMENT.md](/Users/Shared/Projects/reply/docs/LOCAL_MACHINE_DEPLOYMENT.md).

## Development Workflow

Start the hub:

```bash
cd /Users/Shared/Projects/reply
make run
```

Build the native app:

```bash
make build-app
```

Install the native app bundle into `/Applications`:

```bash
cd app/reply-app
./install-bundle.sh
```

## Required Verification

Run the checks that match your change:

```bash
cd /Users/Shared/Projects/reply/chat
npm test
npm run lint
```

For native shell changes:

```bash
cd /Users/Shared/Projects/reply
make build-app
cd app/reply-app
swift build
```

Manual verification is required for:

- conversation sidebar behavior
- thread rendering
- conversation/channel capability truth
- native runtime startup
- sync entry points
- profile loading and saving
- draft outcome reporting

If the change affects shipped UI, verify against the installed `/Applications/reply.app`, not only a dev server.

## Documentation Policy

Every behavior change must update the relevant public docs in the same change.

At minimum, consider:

- [README.md](/Users/Shared/Projects/reply/README.md)
- [docs/CODING_STANDARDS.md](/Users/Shared/Projects/reply/docs/CODING_STANDARDS.md)
- [docs/ARCHITECTURE.md](/Users/Shared/Projects/reply/docs/ARCHITECTURE.md)
- [docs/LOCAL_MACHINE_DEPLOYMENT.md](/Users/Shared/Projects/reply/docs/LOCAL_MACHINE_DEPLOYMENT.md)
- [docs/USER_GUIDE.md](/Users/Shared/Projects/reply/docs/USER_GUIDE.md)
- [docs/DEPENDENCY_MAP.md](/Users/Shared/Projects/reply/docs/DEPENDENCY_MAP.md)

## Pull Request Expectations

Every PR should include:

- the problem statement
- the architectural boundary affected
- commands used for verification
- manual validation notes for native UI or sync behavior
- doc updates

## Current Integration Notes

- Gmail may require reconnect if the saved refresh token is invalid.
- Apple Mail fallback is supported and can populate `mailto:` conversations when Gmail is unavailable.
- Conversation threads are message-backed first and contact-enriched second.
- Contact merge state is manual-only and must not be inferred automatically by heuristics.
- The dashboard can report ingestion totals that are larger than the currently preloaded sidebar page.
