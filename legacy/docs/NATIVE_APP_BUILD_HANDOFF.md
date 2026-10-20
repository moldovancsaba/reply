# Native App Build Handoff

This document is the exact handoff path for how `{reply}` builds and ships its native macOS app.

Use it when another agent or project needs to understand the native app boundary without reverse-engineering the repo.

Documented version context:

- `{reply}` package: `0.5.15`
- native shell target: `macOS 15+`
- Swift toolchain: `Swift 6`

## Canonical Path

- document: `/Users/Shared/Projects/reply/docs/NATIVE_APP_BUILD_HANDOFF.md`
- app root: `/Users/Shared/Projects/reply/app/reply-app`
- packaged bundle output: `/Users/Shared/Projects/reply/app/reply-app/dist/reply.app`
- installed app target: `/Applications/reply.app`

## What The Native App Is

`reply.app` is a native macOS shell built with `SwiftUI` and `AppKit` glue.

It is not the full product runtime by itself.

The app bundle contains and launches:

1. a native executable shell
2. a bundled Node runtime
3. a bundled `{reply}` core directory
4. a bundled `{trinity}` runtime core snapshot
5. a helper executable

The native shell is the operator-facing entrypoint. The local hub and drafting runtime sit behind it.

Identity rule carried by the app:

- the native shell must not imply or perform automatic contact merges
- any merge or unmerge UX must remain explicit and user-owned

## Source Of Truth Files

These files define the native app build and launch contract:

- package manifest: `/Users/Shared/Projects/reply/app/reply-app/Package.swift`
- app metadata: `/Users/Shared/Projects/reply/app/reply-app/Info.plist`
- bundle build script: `/Users/Shared/Projects/reply/app/reply-app/build-bundle.sh`
- bundle install script: `/Users/Shared/Projects/reply/app/reply-app/install-bundle.sh`
- dev build-and-launch script: `/Users/Shared/Projects/reply/script/build_and_run.sh`
- app entrypoint: `/Users/Shared/Projects/reply/app/reply-app/Sources/ReplyApp.swift`
- runtime supervisor and health probing: `/Users/Shared/Projects/reply/app/reply-app/Sources/ReplyCoreService.swift`

If any of those files change, this document must be reviewed.

## Build Contract

### Platform contract

- toolchain: `Swift 6`
- package platform: `macOS 15`
- bundle minimum system version: `15.0`
- bundle identifier: `com.reply.desktop`
- bundle executable: `reply`
- bundle icon file key: `reply`

These values come from:

- `/Users/Shared/Projects/reply/app/reply-app/Package.swift`
- `/Users/Shared/Projects/reply/app/reply-app/Info.plist`

### Swift package targets

The native workspace builds two executables:

- `reply`
- `reply-helper`

Defined in `/Users/Shared/Projects/reply/app/reply-app/Package.swift`.

### Bundle assembly

`/Users/Shared/Projects/reply/app/reply-app/build-bundle.sh` is the canonical bundle assembly script.

It performs these steps in order:

1. resolve `PROJECT_DIR` and `REPO_ROOT`
2. run `swift build`
3. generate the icon by calling `build-icon.sh`
4. recreate `dist/reply.app`
5. copy the native executable into `Contents/MacOS/reply`
6. copy the helper executable into `Contents/Helpers/reply-helper`
7. copy the resolved `node` binary into `Contents/Resources/reply runtime`
8. optionally copy `libnode*.dylib` into `Contents/Resources/`
9. rsync `chat/` into `Contents/Resources/reply-core/chat/`
10. rsync `public/` into `Contents/Resources/reply-core/public/`
11. rsync `{trinity}/core/` into `Contents/Resources/reply-core/trinity-runtime/core/`
12. copy `Info.plist`
13. copy `reply.icns`
14. write `Contents/PkgInfo`
15. attempt ad hoc codesign with `codesign --force --deep --sign -`

### Build-time path assumptions

The bundle builder assumes:

- the `{reply}` repo root is two levels above `app/reply-app`
- the sibling `{trinity}` repo exists at `../trinity` relative to the `{reply}` repo root
- `node` is available on `PATH` unless `REPLY_NODE_BIN` overrides it

The current script resolves the `{trinity}` source from:

- `TRINITY_REPO_ROOT="$(cd "$REPO_ROOT/../trinity" && pwd)"`

That means the build script is not currently parameterized for arbitrary repo layouts.

If another project wants to reuse this build shape, that project must either:

1. preserve the same sibling repo layout, or
2. change `build-bundle.sh` deliberately and document the new resolution rule

## Install Contract

`/Users/Shared/Projects/reply/app/reply-app/install-bundle.sh` is the only accepted install or update path for `/Applications/reply.app`.

Do not replace it with ad hoc `cp` or partial bundle copy commands.

The install script enforces this sequence:

1. require `dist/reply.app` to exist
2. verify required bundle contents before install
3. rsync to a staging bundle in `${TMPDIR:-/tmp}reply-app-install/reply.app`
4. verify the staged bundle again
5. stop running app and related runtime processes
6. remove any existing `/Applications/reply.app`
7. rsync the staged bundle into `/Applications/reply.app`
8. verify the installed bundle again
9. refresh LaunchServices registration
10. restart Dock metadata handling with `killall Dock`

### Required bundle paths

The install script treats these as mandatory:

- `Contents/Info.plist`
- `Contents/MacOS/reply`
- `Contents/Resources/reply runtime`
- `Contents/Resources/reply.icns`
- `Contents/Resources/reply-core`

### Required metadata values

The install verifier rejects the bundle unless:

- `CFBundleIconFile == reply`
- `CFBundleExecutable == reply`

## Launch Contract

For local development, `/Users/Shared/Projects/reply/script/build_and_run.sh` is the native app launch wrapper.

It does four important things beyond just opening the app:

1. kills previous native and bundled hub processes
2. triggers the iMessage mirror daemon before launch
3. builds the bundle by calling `app/reply-app/build-bundle.sh`
4. opens the generated bundle with `open -n`

If called with `--verify`, it also:

1. probes `http://127.0.0.1:45431` through `http://127.0.0.1:45446`
2. waits for `/api/health`
3. accepts readiness when any of these are true:
   - `launch.ready == true`
   - `status == "online"`
   - `ok == true`
4. fails if the native process exits before readiness is confirmed

## Runtime Ownership

The native app entrypoint lives in `/Users/Shared/Projects/reply/app/reply-app/Sources/ReplyApp.swift`.

The app creates a `ReplyCoreService`, starts monitoring immediately, and refreshes health on launch.

`ReplyCoreService` currently owns:

- health polling
- runtime state tracking
- auto-launch behavior
- settings load/save
- native sync actions
- workspace conversation loading
- thread loading
- profile loading
- send orchestration

The preferred bundled runtime ports are:

- `45431` through `45446`

Those are defined in:

- `/Users/Shared/Projects/reply/script/build_and_run.sh`
- `/Users/Shared/Projects/reply/app/reply-app/Sources/ReplyCoreService.swift`

## Exact Commands

### Build only

```bash
cd /Users/Shared/Projects/reply/app/reply-app
./build-bundle.sh
```

Expected artifact:

- `/Users/Shared/Projects/reply/app/reply-app/dist/reply.app`

### Install into `/Applications`

```bash
cd /Users/Shared/Projects/reply/app/reply-app
./install-bundle.sh
```

Expected artifact:

- `/Applications/reply.app`

### Build and launch for development

```bash
cd /Users/Shared/Projects/reply
bash ./script/build_and_run.sh --verify
```

Expected result:

- the native app launches
- one preferred local runtime port reports healthy `/api/health`

## Reuse Rules For Another Project

If another agent wants to reproduce this pattern in a different project, preserve these boundaries explicitly:

1. native shell is a thin operator entrypoint, not the full business runtime
2. bundle assembly is script-owned, not IDE-click-owned
3. install/update path is a verified staged copy, not an ad hoc overwrite
4. bundle verification checks concrete files and metadata before install
5. health verification is runtime-readiness based, not process-exists based
6. the app bundle may embed non-Swift runtime assets and helper binaries when the product requires them

Do not describe the pattern as "just a SwiftUI app". That would be inaccurate for `{reply}`.

It is a native shell around a bundled local runtime stack.

## Validation Checklist

Use this checklist before sharing the build path with another agent:

```bash
cd /Users/Shared/Projects/reply/app/reply-app
swift package dump-package >/dev/null
bash -n ./build-bundle.sh
bash -n ./install-bundle.sh
plutil -lint ./Info.plist
```

```bash
cd /Users/Shared/Projects/reply
bash -n ./script/build_and_run.sh
```

If you need to verify a built bundle structure, check:

```bash
test -f /Users/Shared/Projects/reply/app/reply-app/dist/reply.app/Contents/Info.plist
test -f /Users/Shared/Projects/reply/app/reply-app/dist/reply.app/Contents/MacOS/reply
test -f '/Users/Shared/Projects/reply/app/reply-app/dist/reply.app/Contents/Resources/reply runtime'
test -d /Users/Shared/Projects/reply/app/reply-app/dist/reply.app/Contents/Resources/reply-core
```

## Short Shareable Summary

If another agent asks where the native `{reply}` app is defined, give them this path first:

- `/Users/Shared/Projects/reply/docs/NATIVE_APP_BUILD_HANDOFF.md`

Then tell them to inspect, in order:

1. `/Users/Shared/Projects/reply/app/reply-app/Package.swift`
2. `/Users/Shared/Projects/reply/app/reply-app/build-bundle.sh`
3. `/Users/Shared/Projects/reply/app/reply-app/install-bundle.sh`
4. `/Users/Shared/Projects/reply/script/build_and_run.sh`
5. `/Users/Shared/Projects/reply/app/reply-app/Sources/ReplyApp.swift`
6. `/Users/Shared/Projects/reply/app/reply-app/Sources/ReplyCoreService.swift`

That sequence is the minimum accurate reading order.
