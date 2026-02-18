# {reply} Human Final Decision Policy (Security-First)

## Purpose
This policy defines when AI in `{reply}` may recommend, draft, or execute actions, and where a human approval is mandatory.

## Core rule
- AI may **analyze, summarize, propose, and draft**.
- AI may **not** perform externally impactful actions without explicit human confirmation, unless a written exception exists and is approved.

## Human approval required (default)
- Any outbound communication:
  - iMessage
  - WhatsApp
  - Email
- Any sync/ingestion run that can change indexed state:
  - iMessage sync
  - WhatsApp sync
  - Mail sync
  - Notes sync
- Any high-impact automation that updates KYC/intelligence at scale.

## Allowed without extra approval
- Read-only operations:
  - viewing contacts/messages/KYC
  - retrieval/search in local memory
  - health/status checks
- Explicit dry-run operations where no message is sent and no external side effect occurs.

## Security controls
- Sensitive routes must enforce all of:
  - local-request restriction by default (loopback only)
  - optional operator token validation
  - explicit human approval signal
  - structured audit log entry for allow/deny decisions
- Deny-by-default when control data is missing or invalid.

## Explainability requirement
For each AI recommendation, expose:
- suggested action
- rationale
- confidence
- source signals used
- constraints/policies that affected the recommendation

## Data lineage for KYC
Any KYC/intelligence fact must store:
- source channel
- source reference (message/path/link id)
- timestamp
- confidence
- actor (`ai` vs `human`)
- approval state

## Execution model
- AI assistant role: draft and recommend.
- Human role: approve/reject final action.
- System role: enforce policy gates and persist immutable audit events.

## Exceptions
- Temporary exceptions require:
  - explicit scope
  - owner
  - expiry date/time
  - audit trail
- Expired exceptions must fail closed.

## SSOT linkage
- Policy changes are tracked in SSOT only:
  - Board: <https://github.com/users/moldovancsaba/projects/1>
  - Issues repo: `moldovancsaba/mvp-factory-control`
