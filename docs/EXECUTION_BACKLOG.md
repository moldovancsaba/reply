# Reply Execution Backlog

## Objective

Deliver the `{reply}` portion of the cross-project boundary program without mixing repository ownership.

`{reply}` remains the product shell. It owns channels, operator workflow, local app integration, and outbound execution. It must stop growing a parallel canonical brain.

## Milestones

### M1. Boundary Insertion

- [x] Add a brain-runtime adapter so product callers stop importing the legacy reply engine directly.
- [x] Fix suggestion result normalization so API handlers do not persist structured objects as draft text.
- [x] Fix `channel-bridge.js` lint/runtime break caused by the missing data-home directory symbol.
- [x] Record the execution backlog and issue queue in-repo.

### M2. Trinity Alignment

- [ ] Map channel and conversation evidence into the Trinity reply contract.
- [ ] Add shadow-mode comparison between legacy drafting and Trinity candidate outputs.
- [ ] Route one bounded operator workflow through the Trinity adapter boundary.

### M3. Legacy Retirement

- [ ] Remove direct brain ownership from legacy runtime paths after Trinity cutover succeeds.
- [ ] Move feedback semantics onto the Trinity-owned contract once feedback memory is available upstream.

## Active Issue Queue

### Closed

- `REPLY-001` Missing brain-runtime adapter
  Product routes and workers imported `reply-engine.js` directly, which made the legacy engine the de facto canonical brain. Fixed by inserting `chat/brain-runtime.js` as the caller-facing boundary.

- `REPLY-002` Broken suggestion normalization in `/api/suggest-reply`
  The route could persist a structured reply result instead of the actual suggestion text. Fixed by normalizing all reply results before saving or returning them.

- `REPLY-003` `channel-bridge.js` referenced an undefined data directory symbol
  This broke linting and risked audit-log persistence failures. Fixed by using `ensureDataHome()` instead of the missing symbol.

- `REPLY-004` Critical dependency audit under local intelligence stack
  `@xenova/transformers` resolved vulnerable ONNX and protobuf transitives. Fixed by updating `imapflow` and adding safe dependency overrides for `onnxruntime-web` and `protobufjs`, followed by a clean audit pass.

### Open

- `REPLY-005` Trinity shadow-mode execution
  The adapter boundary exists, but `{reply}` still uses the legacy engine as the active implementation. Shadow-mode comparison is the next safe step.

- `REPLY-006` Dev-toolchain major-version upgrade lane
  `chat` is clean on tests, lint, audit, and the native package rebuild after safe dependency updates, but major upgrades remain for the ESLint toolchain. Those should be handled in a dedicated compatibility pass rather than mixed into runtime-boundary work.

## Dependencies

- Depends on `{trinity}` for canonical runtime vocabulary and future candidate/frontier execution.
- Feeds `{train}` only through offline fixtures and bounded evaluation artifacts, never by handing over product orchestration.
