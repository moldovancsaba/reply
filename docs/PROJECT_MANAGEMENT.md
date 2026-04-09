# Project Management & SSOT Guidelines

**Purpose:** This document defines how we work. It is the rulebook for maintaining the Single Source of Truth (SSOT).
**Audience:** All Agents (Agnes, Tribeca, etc.) and Developers.

## 1. Safety & Hallucinations (CRITICAL AGENT RULES)
*   **NEVER Hallucinate:** If you don't see it, ask. Do not guess commands or UI states.
*   **Read Before Do:** Verify credentials (e.g., `gh auth status`) and capability before attempting actions.
*   **Clarify:** If a CLI command fails or hangs, STOP. Do not retry blindly. Ask the user for help.
*   **zsh quoting:** In `zsh`, unquoted `{reply}` in commands can trigger brace-expansion parse errors. When using `gh issue create -t '{reply}: ...'` always wrap the title in **single quotes** (or escape braces).

## 2. The Single Source of Truth (SSOT)
For **`{reply}` product work**, the **GitHub Project** and **issues** live in this repository:

*   **Board (Project #7):** https://github.com/users/moldovancsaba/projects/7  
*   **Issues repo:** `moldovancsaba/reply`

Cross-portfolio governance and other products may still use [`moldovancsaba/mvp-factory-control`](https://github.com/moldovancsaba/mvp-factory-control) and [MVP Factory Board (Project #1)](https://github.com/users/moldovancsaba/projects/1); that is **not** where new `{reply}` tasks are opened.

*   **Rule:** If it's not on **Project #7**, it isn't tracked for `{reply}` delivery.
*   **Rule:** The **Status** field on the project defines workflow stage. Do NOT put status in titles (e.g. `[Backlog] Issue Title` is ILLEGAL).
*   **Rule:** Issue title convention: `{reply}: <short description>` (no status/prefix noise).
*   **Rule:** Documentation (`HANDOVER.md`) should be updated when a task is completed, in line with the board.
*   **Rule:** Create and manage **`{reply}` issues in `moldovancsaba/reply`** and add them to **Project #7** immediately.
*   **Rule:** Do not track `{reply}` tasks only in local `IDEABANK.md`, `ROADMAP.md`, `TASKLIST.md`, or similar files.

## 3. Mandatory Issue Recording & Management SOP
Use this process for every `{reply}` task/idea/bug.

1. **Create issue in** `moldovancsaba/reply`.
2. **Use title format**: `{reply}: <short description>`.
3. **Add issue to Project #7 immediately:** https://github.com/users/moldovancsaba/projects/7
4. **Set project fields** as applicable (**Status** required). Use **Labels** (or Milestone) for type/priority if the project has no separate custom fields.
5. **When work starts:** assign owner and set `Status` to *In Progress* (or your board’s equivalent).
6. **When work ends:** comment with what changed + verification + user test steps; set `Status=Done` (or equivalent) and close the issue.
7. **Verify** the issue appears on Project #7 before ending the task.

### Mandatory CLI sequence (safe quoting)
```bash
# 1) Create issue (single-quote title to avoid zsh brace expansion)
gh issue create --repo moldovancsaba/reply \
  --title '{reply}: <short description>' \
  --body-file /tmp/issue.md

# 2) Add to Project #7 (MANDATORY)
gh project item-add 7 --owner moldovancsaba --url <issue-url>

# 3) Verify item is on board (use high limit; default 30 can hide items)
gh project item-list 7 --owner moldovancsaba -L 500 --format json
```

### Prohibited
- Do not open **new** `{reply}`-scoped work only in `mvp-factory-control` without also tracking it on **Project #7** in the `reply` repo (canonical path is **reply** + **Project #7**).
- Do not track tasks in local `IDEABANK.md`, `ROADMAP.md`, `TASKLIST.md`, or similar files as SSOT.
- Do not leave an issue out of Project #7 after creation.

## 4. Issue Structure (What good looks like)
Every issue on the board must follow this structure to be "Ready":

1.  **Objective:** One specific, deliverable goal.
2.  **Context:** Why are we doing this? Link to parent issues or roadmap items.
3.  **Scope:** What is IN and what is OUT.
4.  **Dependencies:** What specific issue numbers must be Done first?
5.  **Acceptance Criteria (DoD):** A checklist of verifiable results. "It works" is not enough; "UAT Passed" is required.

## 5. Board Fields & How to Fill Them
Accurate metadata is critical for filtering and finding work.

| Field | Description | Rules |
| :--- | :--- | :--- |
| **Status** | The current workflow stage. | **Backlog**: Unsorted ideas. **Ready**: Fully defined & unblocked. **In Progress**: Active now. **Done**: Verified & Merged. |
| **Agent** | Who is responsible? | Assign to **Agnes** (or relevant agent) when moving to "Ready". |
| **Product** | (On MVP Factory board only.) | For `{reply}` work in **this** repo, the whole project **is** `{reply}` — use **Labels** if you need product tags elsewhere. |
| **Type** | The nature of work. | `Feature` (New value), `Bug` (Fix), `Refactor` (Cleanup), `Docs` (Knowledge). |
| **Priority** | Urgency. | `P0` (Critical/Blocker), `P1` (High), `P2` (Normal). |
| **Release** | version/milestone. | Text field. Use semantic versioning (e.g., `v0.2.0`). |
| **DoD** | Definition of Done status. | `Passed` is required to close an issue. |

## 6. The "Agnes" Workflow
1.  **Pick Up:** Find the top `P0` item in **Ready**.
2.  **Assign:** Ensure **Agent** is set to `Agnes`.
3.  **Execute:** Work on the task.
4.  **Verify:** Run tests and UAT.
5.  **Close:** Move to **Done**, set **DoD** to `Passed`.
6.  **Document:** Update `HANDOVER.md` and `RELEASE_NOTES.md`.

## Appendix: SSOT CLI Commands (`{reply}`)
**CRITICAL:** `gh project item-list` may not expose every custom field in JSON. Use `gh issue list` against **`moldovancsaba/reply`** for reliable triage.

```bash
# 1) Find YOUR currently assigned issues
gh issue list --repo moldovancsaba/reply --state open --assignee "@me" --search "{reply}" --limit 20

# 2) View recent open issues
gh issue list --repo moldovancsaba/reply --state open --search "{reply}" --limit 50 --json number,title,state,assignees

# 3) View a specific issue
gh issue view <issue-number> --repo moldovancsaba/reply
```

## Historical note
Older `{reply}` issues may still reference `mvp-factory-control#…` in docs and comments. Prefer **new** issues in **`moldovancsaba/reply`** on [Project #7](https://github.com/users/moldovancsaba/projects/7). Migration helper: [`GITHUB_REPLY_PROJECT_MIGRATION.md`](GITHUB_REPLY_PROJECT_MIGRATION.md).

## Security verification (recurring)
```bash
cd /path/to/reply
node chat/security-audit.js
node chat/security-audit.js --fix
```
