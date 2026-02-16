# Reply — Codex brain dump

Current job, where we left off, and open decisions. Update this at the end of each session.

---

## Current status

- **POC chat:** Localhost chat UI in `chat/` (Node, no deps). Run `cd chat && npm start`, open http://localhost:3000. Type/paste message, click "Suggest reply"; keyword-based suggestions + optional "From your notes" snippets (#154).
- **POC knowledge:** Local-file ingestion in `chat/ingest.js` and `chat/knowledge.js`; store in `knowledge/store.json`. Run `node chat/ingest.js`; suggest-reply API returns `snippets` when message matches ingested text (#162 delivered).
- **App:** SwiftUI "Reply Machine" with `ReplyEngine` (keyword rules) and `ContentView`. Runs on macOS.
- **Exploration:** GraphQL JSON files in repo root for GitHub Project V2; not yet integrated.
- **Docs:** ROADMAP, TASKLIST, RELEASE_NOTES, POC_FIRST_FUNCTIONS, brain dump. Board is source of truth.

## Where we left off

- Reply onboarding completed (issues #158–#161): agent operating document and README row in mvp-factory-control; ROADMAP, TASKLIST, RELEASE_NOTES, brain dump in reply repo; README expanded; #153 and #154 set to Product = reply, Status = Backlog. Next actionable work comes from the board (Product = reply, Status = Ready).

## Next

- **POC delivery:** #154 (localhost chat UI) and #162 (knowledge ingestion — design + first source). First functions are in [POC_FIRST_FUNCTIONS.md](POC_FIRST_FUNCTIONS.md). Pick from board (Product = reply, Status = Ready).
- Later: board API integration, more knowledge sources (Gmail, Drive, iCloud, Notes, calendar), messaging connectors.
