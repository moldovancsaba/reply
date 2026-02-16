# Reply

Reply is a local reply app (SwiftUI). It generates or suggests replies to messages using keyword-based rules today; optional integration with the MVP Factory Board and messaging channels is planned.

---

## Project board

Work for Reply is tracked on the [MVP Factory Board](https://github.com/users/moldovancsaba/projects/1). Filter by **Product = reply** for tasks and status. Source of truth for next work is the board, not local task files.

---

## For agents

Agent rules and cold-start instructions for Reply are in the **mvp-factory-control** repo: [agent-operating-document-reply.md](https://github.com/moldovancsaba/mvp-factory-control/blob/main/docs/agent-operating-document-reply.md). Use that doc for board workflow, where documents are, and how to pick the next task.

---

## How to run

### POC: Localhost chat (reply suggestions in the browser)

1. From the repo root: `cd chat && npm start`
2. Open in a browser: **http://localhost:3000**
3. Type or paste a message and click **Suggest reply** to see a suggested reply in the chat.

No install needed (Node built-ins only). Node 18+.

### SwiftUI app (macOS)

1. Open the project in Xcode (e.g. open `Reply.xcodeproj` or the workspace from the repo root).
2. Select the **Reply** scheme and a run destination (e.g. My Mac or a simulator).
3. Run (⌘R). The Reply Machine window shows an input field and a "Generate Reply" button; enter text and tap to see the generated reply.

Requirements: macOS (SwiftUI); Xcode 14+ recommended.
