# Documentation

Reply Core is a local-first unified inbox for macOS. These are its documents, by what you want to do.

## Use it

| Document | For |
|---|---|
| [USER_GUIDE.md](USER_GUIDE.md) | Daily use: the inbox, conversations, profiles and notes, search, merging people, sending, reply suggestions, troubleshooting |
| [CORE_FIRST_RUN.md](CORE_FIRST_RUN.md) | Setting it up the first time, with screenshots |
| [CORE_PERMISSIONS.md](CORE_PERMISSIONS.md) | Every macOS permission it needs and why |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | What does not work yet, limits, and checks that need a person |
| [../CHANGELOG.md](../CHANGELOG.md) | Release notes |

## Run it

| Document | For |
|---|---|
| [CORE_OPERATIONS.md](CORE_OPERATIONS.md) | Launcher, start at login, logs, backups, restore, rebuild, release gate, scale check |
| [CORE_STATUS.md](CORE_STATUS.md) | The status report and the recovery steps it gives |
| [CORE_SECURITY.md](CORE_SECURITY.md), [../SECURITY.md](../SECURITY.md) | What is protected and how, and how to report a vulnerability |

## Understand and change it

| Document | For |
|---|---|
| [CORE_ARCHITECTURE.md](CORE_ARCHITECTURE.md) | Components, runtime flow, who owns which file, conventions |
| [TECH_DESIGN.md](TECH_DESIGN.md) | Low-level design: data flow, contracts, concurrency, failure behaviour, performance |
| [CORE_DATA_MODEL.md](CORE_DATA_MODEL.md) | Tables, migrations, invariants |
| [CORE_API.md](CORE_API.md) | Every HTTP endpoint, errors, caching |
| [CORE_CONNECTORS.md](CORE_CONNECTORS.md) | The connector framework and each source |
| [CORE_IDENTITY.md](CORE_IDENTITY.md) | Handle normalization, contacts, merge and undo |
| [CORE_SENDING.md](CORE_SENDING.md), [CORE_HANDOFF.md](CORE_HANDOFF.md) | Sending a message, and opening it in the app instead |
| [CORE_DRAFTING.md](CORE_DRAFTING.md) | The optional local-model reply suggestion |
| [CORE_UI.md](CORE_UI.md) | The screens, states, scroll and layout rules |
| [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) | How the GDS design system is used, local patterns, workarounds |
| [CORE_PLAN.md](CORE_PLAN.md) | The original plan (historical) and what changed |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | How to contribute, the rules, the checks |

## Not current

[`../legacy/`](../legacy/README.md) holds the previous generation of the project (a Node hub, a native shell and the documents about them). It is archived for reference, is not developed and its documents describe a different system.

## Keeping these true

`node core/scripts/audit.js` (part of `npm run verify:release`) fails on broken links, obsolete wording, a changelog that does not match the version, a migration missing from the data model, personal data and secrets.
