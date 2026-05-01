# `{reply}` macOS Distribution Audit

This audit records the current native macOS delivery shape for `{reply}` and the exact delta required for durable production deployment.

## Current State

### Product identity

- Bundle: `reply.app`
- Bundle identifier: `com.reply.desktop`
- Display name: `reply`
- Executable: `reply`

### Runtime packaging

`reply.app` now bundles three distinct runtime components:

- Main app UI:
  - `reply.app/Contents/MacOS/reply`
- Protected-data helper:
  - `reply.app/Contents/Helpers/reply-helper`
- Node runtime for the local hub:
  - `reply.app/Contents/Resources/reply runtime`
- Bundled hub code:
  - `reply.app/Contents/Resources/reply-core/chat`

The app no longer needs the repo checkout as its primary execution root. The bundle contains the hub runtime and starts `server.js` from the packaged `reply-core/chat` tree.

### Mutable data locations

Mutable data and logs are app-owned:

- Data:
  - `~/Library/Application Support/reply`
- Logs:
  - `~/Library/Logs/reply`

Legacy `Reply` paths are still migrated forward for compatibility.

### Protected-data access

The app now uses a first-class helper executable for the protected iMessage read path:

- Helper:
  - `reply-helper`
- Current role:
  - mirror `~/Library/Messages/chat.db` into the app-owned mirror store
- Mirror target:
  - `~/Library/Application Support/reply/apple-source-mirrors/imessage/chat.db`

This is materially better than granting Full Disk Access to a generic Homebrew `node` binary. It gives the protected-data path a stable in-bundle identity.

### Native operational surfaces

The app now has native operational surfaces instead of relying only on the embedded browser UI:

- Workspace window:
  - conversation-focused shell
- Control Center window:
  - runtime, channels, preflight, logs
- Native Settings window:
  - AI runtime, worker, health, sync controls

The embedded web workspace remains transitional UI debt. It is no longer the only control plane.

## What Is Correct Now

- `{reply}` is packaged as a real macOS app bundle.
- The app can run from the bundle instead of the repo checkout.
- Mutable data is moved out of source-controlled runtime paths.
- The protected iMessage read path has a dedicated helper identity.
- Runtime configuration and operational sync controls are available natively.

## What Is Still Missing For Production

### Signing and notarization

The current bundle is still locally ad hoc signed. Production requires:

- `Developer ID Application`
- stable designated requirements
- notarization on every release
- install into `/Applications/reply.app`

### Durable TCC / Full Disk Access behavior

For unmanaged installs:

- prompt the operator once for the final shipped helper identity
- document the exact helper path and bundle identity

For managed installs:

- ship a PPPC / MDM profile option
- grant `System Policy All Files` to the final signed helper identity

### Helper hardening

`reply-helper` is the correct identity direction, but it is still a single executable helper. The next production step is to decide between:

- preferred:
  - XPC service / helper with stable signed identity
- acceptable:
  - keep the bundled helper executable with stable signing requirement

## Immediate Delivery Delta

1. Ship `reply.app` to `/Applications` as the only supported production path.
2. Sign `reply.app` and `reply-helper` with the same Developer ID team.
3. Keep:
   - `CFBundleIdentifier = com.reply.desktop`
   - helper identity stable across releases
4. Generate and document the designated requirement strings with:
   - `codesign -dr - /Applications/reply.app`
   - `codesign -dr - /Applications/reply.app/Contents/Helpers/reply-helper`
5. Add unmanaged FDA onboarding targeting `reply-helper`.
6. Add managed PPPC deployment targeting the final signed helper identity.

## Things `{reply}` Must Not Regress To

- No dependence on Terminal or Codex having FDA.
- No dependence on repo-relative runtime roots.
- No rotating helper identities across builds.
- No assumption that app-level FDA automatically covers an unrelated helper.

## Issue Mapping

- `#122`
  - this audit document and the signing/runtime/TCC gap analysis
- `#114`
  - packaged app-owned runtime and mutable data relocation
- `#115`
  - native permissions and dependency center
- `#123`
  - stable helper identity for protected-data access
- `#121`
  - native operational surfaces replacing browser-only admin flows
