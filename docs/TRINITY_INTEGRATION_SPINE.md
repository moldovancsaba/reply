# Reply Trinity Integration Spine

## Objective

Route one real Reply suggestion path through Trinity and make Trinity the only shipped drafting runtime.

## Deliverable Issues

1. Add `ThreadSnapshot` construction from one real conversation path.
2. Add `TrinityClient` and a release policy that ships Trinity-only app behavior.
3. Route `/api/suggest` through Trinity when enabled.
4. Render top 3 ranked candidates in the composer surface.
5. Preserve `cycle_id` and `candidate_id` through operator selection and send.
6. Emit deterministic `DraftOutcomeEvent` records:
   - `SHOWN`
   - `SELECTED`
   - `SENT_AS_IS`
   - `EDITED_THEN_SENT`
   - `REJECTED`
   - `IGNORED`
   - `MANUAL_REPLACEMENT`
   - `REWORK_REQUESTED`
7. Keep any legacy path behind explicit developer-only flags and out of shipped app behavior.

## Compatibility Rules

1. Reply sends versioned UTC payloads only.
2. Reply never reads Trinity runtime storage directly.
3. Reply does not let Train bypass Trinity.
