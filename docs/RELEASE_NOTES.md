# Reply — Release notes

Completed work only. Board "Done" column is the source of truth for delivered items.

---

## 2026-02-16 — POC: Localhost chat UI (#154)

- **Chat on localhost:** Browser UI at http://localhost:3000. User can type or paste a message and click "Suggest reply"; suggested reply is shown in the chat. Implemented in `chat/` (Node, no extra deps). Same keyword-based logic as ReplyEngine for POC.

## 2026-02-16 — Initial app and docs

- **SwiftUI Reply Machine:** Simple app with keyword-based reply generation (ReplyEngine + ContentView).
- **GraphQL exploration:** JSON files for GitHub Project V2 API (project id, fields, add item, set agent/product/fields) in repo root; not yet wired into the app.
- **Product onboarding:** Reply added as a product on the MVP Factory Board; agent operating document and repo docs (ROADMAP, TASKLIST, RELEASE_NOTES, brain dump) added; README expanded; issues #153 and #154 set to Product = reply.
