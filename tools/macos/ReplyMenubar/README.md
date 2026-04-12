# ReplyMenubar (macOS)

Small **menu bar** app for `{reply}`: polls `http://127.0.0.1:45311/api/health`, shows hub / Hatori / Ollama / OpenClaw / channel hints, opens the web UI, tails service logs, and runs `make install-service` / LaunchAgent helpers against the **repository root** baked in at build time.

## Prerequisites

- **macOS** with **Xcode Command Line Tools** (`swiftc`). Install with:

  ```bash
  xcode-select --install
  ```

- **Node** (optional): used only to read `chat/package.json` for the version string in the menu title.

- The **{reply} hub** is separate: install and run it with LaunchAgent or foreground mode per **[docs/LOCAL_MACHINE_DEPLOYMENT.md](../../../docs/LOCAL_MACHINE_DEPLOYMENT.md)**.

## Install (recommended)

From the **repository root**:

```bash
make install-ReplyMenubar
```

This runs `tools/macos/ReplyMenubar/install_ReplyMenubar.sh`, which:

1. Substitutes `__REPO_ROOT__` and `__APP_VERSION__` in `main.swift.template` → generated `main.swift`.
2. Compiles `main.swift` + `MenubarCore.swift` with `swiftc` (AppKit / Foundation / CoreText).
3. Writes **`~/Applications/ReplyMenubar.app`** with a minimal `Info.plist` (`LSUIElement` = menu-bar-only).

Launch:

```bash
make run-ReplyMenubar
# or
open ~/Applications/ReplyMenubar.app
```

### First launch / Gatekeeper

If macOS blocks the app, use **System Settings → Privacy & Security → Open Anyway**, or right-click the app → **Open** once.

## Optional: Material icon font

If you add `MaterialSymbolsOutlined.ttf` next to this README (`tools/macos/ReplyMenubar/MaterialSymbolsOutlined.ttf`), the install script copies it into the app bundle **Resources** and the template loads it for the tray glyph. If the font is missing, the app shows **R** in the menu bar.

## Rebuild after moving the repo

`repoRoot` is compiled into the binary. If you **move or clone the repo to a new path**, run `make install-ReplyMenubar` again so **Restart Service**, **Start/Install Service**, and `make status` target the correct tree.

## Port note

The menubar reads **`PORT`** from `chat/.env` at the baked-in repo root, then probes **`PORT`…`PORT+15`** for `/api/health`. When the hub returns **`httpPort`** in JSON, that canonical port is used for “Open UI” and OpenClaw URLs. Rebuild the app after changing repo location (`make install-ReplyMenubar`).

## Source layout

| File | Purpose |
|------|---------|
| `main.swift.template` | Menu UI, health polling, `make`/LaunchAgent actions; placeholders `__REPO_ROOT__`, `__APP_VERSION__`. |
| `MenubarCore.swift` | Shared helpers (font, glyph image, shell). |
| `install_ReplyMenubar.sh` | Generate `main.swift`, `swiftc`, install bundle. |

## See also

- **[docs/LOCAL_MACHINE_DEPLOYMENT.md](../../../docs/LOCAL_MACHINE_DEPLOYMENT.md)** — LaunchAgent hub, logs, `.env`, Ollama, iMessage `chat.db`.
- Root **[README.md](../../../README.md)** — `make run`, `make status`, menubar targets.
