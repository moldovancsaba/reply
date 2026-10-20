# {reply} / {trinity} / {train} Policy Loop Breakdown

## Purpose

This document turns the current cross-project direction into an exact repo-by-repo execution map.

The target loop is:

1. `{reply}` exports deterministic operator reality.
2. `{trinity}` owns live drafting and policy application.
3. `{train}` optimizes narrow behavior slices offline.
4. promotion back into `{trinity}` is explicit, versioned, replay-gated, and reversible.

This is not whole-brain training.
This is not direct `{reply}` optimization.
This is not autonomous runtime mutation.

## Current Boundary

- `{reply}` owns ingestion, operator workflow, send execution, and outcome capture.
- `{trinity}` owns live drafting runtime behavior.
- `{train}` owns bounded offline optimization only.

## Repo-By-Repo Issues

### `{reply}`

#### `REPLY-POLICY-001` Export contract hardening

Scope:
- keep `{reply}` as an exporter of runtime facts only
- stop any drift toward local learning logic

Deliver:
- deterministic `ThreadSnapshot` export from the live conversation path
- deterministic `DraftOutcomeEvent` export from operator actions
- explicit `contract_version` on every cross-repo payload

Acceptance:
- the same cycle exports the same payload from the same source state
- product-private local state is not dumped outside the bounded contract

#### `REPLY-POLICY-002` Active policy provenance emission

Scope:
- ensure every exported cycle identifies which `{trinity}` artifact version shaped runtime behavior

Deliver:
- include `accepted_artifact_version` or `accepted_policy_version` metadata in the trace/export handoff
- preserve `cycle_id`, `candidate_id`, `thread_ref`, `channel`, `outcome disposition`

Acceptance:
- every exported cycle can be replayed against the exact runtime artifact version used live

#### `REPLY-POLICY-003` Product gate separation

Scope:
- keep product and transport policy in `{reply}`, not in learned runtime artifacts

Must remain in `{reply}`:
- send gating
- human approval
- bridge-vs-native classification
- outbound verification
- transport/channel truth

Acceptance:
- behavior artifacts can shape draft behavior
- behavior artifacts cannot override transport or safety gates

#### `REPLY-POLICY-004` Training-bundle handoff shape

Scope:
- export only what `{train}` needs for offline bounded learning

Deliver:
- cycle trace reference
- selected candidate metadata
- final sent text
- edit-distance / rewrite severity
- latency
- channel and contact scope metadata

Acceptance:
- `{reply}` does not become a schema dumping ground for `{train}`

### `{trinity}`

#### `TRINITY-POLICY-001` `ReplyBehaviorPolicy` schema and validator

Scope:
- define the first bounded policy artifact family

Initial sections:
- `tone_preferences`
- `brevity_preferences`
- `channel_rules`

Initial scopes:
- `global`
- `channel`
- `thread_type`

Out of scope initially:
- contact-specific policy
- company-specific policy
- hidden runtime heuristics

Acceptance:
- load/save/validate works
- invalid artifact is rejected
- precedence is deterministic

#### `TRINITY-POLICY-002` Accepted policy/artifact registry

Scope:
- track which accepted runtime artifact version was active for a cycle

Deliver:
- explicit accepted artifact registry
- immutable versions
- explicit promotion metadata
- explicit rollback metadata

Acceptance:
- one-step rollback
- no shared-write or hidden mutation path

#### `TRINITY-POLICY-003` Training bundle export

Scope:
- export bounded learning bundles from live cycles

Initial bundle types:
- `tone-learning`
- `brevity-learning`
- `channel-formatting-learning`

Acceptance:
- bundle generation is deterministic
- bundle links back to cycle/trace IDs
- bundle corpus is replayable offline

#### `TRINITY-POLICY-004` Runtime policy loader/resolver

Scope:
- apply accepted artifacts at runtime without collapsing policy and product ownership

Initial precedence:
1. `channel`
2. `global`

Initial runtime application points:
- generator prompt shaping
- refiner constraints
- evaluator hints
- ranking/strategy hints

Must not affect:
- send lifecycle semantics
- transport rules
- safety gates

Acceptance:
- traces show the artifact version applied
- runtime behavior changes are attributable

#### `TRINITY-POLICY-005` Acceptance gate workflow

Scope:
- promotion is a workflow, not a side effect

Gate:
1. schema validation
2. scope validation
3. replay on fixtures
4. compare against incumbent
5. reject on regression threshold
6. explicit promotion only

Acceptance:
- copy-forward promotion
- explicit rollback
- accepted artifacts are locally registered

### `{train}`

#### `TRAIN-POLICY-001` Training bundle loader

Scope:
- consume exported bounded learning bundles from `{trinity}`

Deliver:
- strict schema validation
- contract-version validation
- deterministic fixture loading

Acceptance:
- malformed bundles are rejected
- bundles can be replayed repeatedly with stable results

#### `TRAIN-POLICY-002` Tone learner

Scope:
- first narrow learner

Inputs:
- selected candidate
- final sent text
- rewrite severity
- channel
- thread type

Output:
- candidate `ReplyBehaviorPolicy` proposal for tone

Acceptance:
- incumbent vs proposal comparison is reproducible

#### `TRAIN-POLICY-003` Brevity learner

Scope:
- reduce rewrite severity caused by length mismatch

Output:
- bounded brevity policy proposal

Acceptance:
- proposal improves rewrite severity or holdout quality without causing regressions

#### `TRAIN-POLICY-004` Channel formatting learner

Scope:
- learn bounded formatting expectations per channel

Examples:
- greeting shape
- link formatting
- attachment reference style
- newline density

Acceptance:
- output remains explicit policy, not opaque prompt drift

#### `TRAIN-POLICY-005` Proposal artifact and eval report

Scope:
- every training run produces:
  - proposed artifact
  - incumbent comparison
  - replay/eval report

Acceptance:
- results are versioned
- results are promotion-ready but never self-promoting

## Exact Schema List

Canonical schema ownership stays in `{trinity}`.

This repo should not duplicate the full field-level catalog for shared wire contracts, because that would create a second documentation source of truth and drift risk.

Canonical reference:
- `/Users/Shared/Projects/trinity/docs/POLICY_LOOP_REPO_BREAKDOWN.md`

`{reply}`-specific contract responsibilities:
- populate `ThreadSnapshot` deterministically from product state
- emit `DraftOutcomeEvent` deterministically from operator actions
- preserve `contract_version` on every outbound runtime payload
- preserve the canonical accepted artifact provenance already carried by `{trinity}` runtime outputs

## Recommended Order

1. freeze the current live seam
2. harden `{reply}` export contract
3. define `ReplyBehaviorPolicy` in `{trinity}`
4. add `TrainingBundle` export in `{trinity}`
5. build `{train}` tone learner first
6. add replay-based promotion gate
7. load accepted artifacts in `{trinity}`
8. expand later into ranking and strategy
