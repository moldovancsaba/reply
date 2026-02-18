# {reply} — Learnings & Decisions

## Product / Workflow
* **SSOT:** Roadmap + tasks are tracked only in the GitHub Project Board and as issues in `moldovancsaba/mvp-factory-control`.
* **No product-repo issues:** Do not create/manage issues in `moldovancsaba/reply` (Issues are disabled there to prevent drift).
* **Naming:** The system name is **`{reply}`**. Do not rename it (no “Hub”, no prefixes).

## Settings & Privacy
* Settings are stored locally in `chat/data/settings.json` (not encrypted).
* Gmail OAuth stores a refresh token locally for best UX (local-first).
* General Settings must not include per-service UI controls; those belong only to the relevant service configuration.

## Email Sending
* When Gmail is connected, email sends via Gmail API automatically.
* If Gmail isn’t connected (or send fails), {reply} falls back to Mail.app by opening a compose window (no auto-send in fallback).
* Gmail OAuth gotchas: the Google Cloud project must have **Gmail API enabled**, and OAuth consent/app testing must allow your account (test user) during development.

## Worker Behavior
* Email sync runs automatically only when Gmail OAuth or IMAP is configured (to avoid triggering Apple Mail AppleScript unintentionally).
* Worker interval is configurable (clamped for safety).

## UI
* `🎤 Mic`, `✨ Magic`, `💡 Suggest` are **feed-only** controls (hidden on Dashboard).

## CLI Gotchas
* When using `gh issue comment --body "..."` in `zsh`, **backticks execute**. Use `--body-file` or single quotes.
