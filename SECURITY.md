# Security policy

Reply Core handles private conversations, so it is built local-first: everything runs on your Mac, the service listens on `127.0.0.1` only, and nothing is sent to a cloud service. The rules it enforces, and where, are in [docs/CORE_SECURITY.md](docs/CORE_SECURITY.md); the permissions it needs are in [docs/CORE_PERMISSIONS.md](docs/CORE_PERMISSIONS.md); how messages are sent is in [docs/CORE_SENDING.md](docs/CORE_SENDING.md).

## Supported versions

Only the newest release receives fixes. See [CHANGELOG.md](CHANGELOG.md).

## Reporting a vulnerability

Please report it privately through GitHub: **Security > Report a vulnerability** on this repository. Do not open a public issue for a vulnerability. Include what you did, what happened, and the version. You will get an answer within a few days; a fix is released as a patch version with a note in the changelog.

## What belongs in scope

- the loopback API (`core/src`): anything reachable from another machine, another origin or another local user, any way to read or change data without the person's action, any way a message text or address reaches a log;
- sending: any way to send a message without an explicit Send, to a recipient that is not the contact's own handle, or twice;
- the signed `{reply}.app` host and the launch agent;
- secrets handling (IMAP passwords live only in the macOS keychain).

## Handling of personal data in this repository

No conversation data, contact data, database or secret is ever committed (`node scripts/audit.js` fails the release gate if one is). Test data is synthetic. If you find personal data or a secret in this repository or its history, report it as above.

History note (2026-10): an earlier layout of this repository committed personal files and an API key. The history of every branch was rewritten on 2026-10-20 and the key was revoked, and the audit guards against a repeat. GitHub still keeps the old pull-request objects, so the removed files stay fetchable by commit SHA; this residual exposure is accepted and listed in [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md).
