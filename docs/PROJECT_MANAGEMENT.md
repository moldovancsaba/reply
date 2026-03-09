# Project Management & SSOT Guidelines

**Purpose:** This document defines how we work. It is the rulebook for maintaining the Single Source of Truth (SSOT).
**Audience:** All Agents (Agnes, Tribeca, etc.) and Developers.

## 1. Safety & Hallucinations (CRITICAL AGENT RULES)
*   **NEVER Hallucinate:** If you don't see it, ask. Do not guess commands or UI states.
*   **Read Before Do:** Verify credentials (e.g., `gh auth status`) and capability before attempting actions.
*   **Clarify:** If a CLI command fails or hangs, STOP. Do not retry blindly. Ask the user for help.
*   **zsh quoting:** In `zsh`, unquoted `{reply}` in commands can trigger brace-expansion parse errors. When using `gh issue create -t '{reply}: ...'` always wrap the title in **single quotes** (or escape braces).

## 2. The Single Source of Truth (SSOT)
The **GitHub Project Board** is the ONLY source of truth for what is being worked on, and **all issues for `{reply}` live in the SSOT repo**:

*   Board: https://github.com/users/moldovancsaba/projects/1
*   SSOT Issues Repo: `moldovancsaba/mvp-factory-control`

*   **Rule:** If it's not on the board, it doesn't exist.
*   **Rule:** The **Status Column** defines the state (Backlog, Ready, In Progress, Done). Do NOT put status in titles (e.g., `[Backlog] Issue Title` is ILLEGAL).
*   **Rule:** Issue title convention for Reply: `{reply}: <short description>` (no status/prefix noise).
*   **Rule:** Documentation (`HANDOVER.md`) must be updated *immediately* after a task is completed to match the board.
*   **Rule:** Do **NOT** create/manage issues in product repositories (e.g. `moldovancsaba/reply`). Issues live in the SSOT repo (currently `moldovancsaba/mvp-factory-control`) and are tracked via the Project Board.
*   **Rule:** Issues are disabled in `moldovancsaba/reply` to prevent accidental drift away from SSOT.

## 3. Mandatory Issue Recording & Management SOP
Use this exact process for every `{reply}` task/idea/bug.

1. **Create issue in SSOT repo only** (`moldovancsaba/mvp-factory-control`).
2. **Use title format**: `{reply}: <short description>`.
3. **Add issue to Project 1 immediately**: https://github.com/users/moldovancsaba/projects/1
4. **Set required board fields**: `Product=reply`, correct `Type`, `Priority`, `Status`.
5. **When work starts**: assign owner/agent and set `Status=In Progress`.
6. **When work ends**: comment with what changed + verification + user test steps, then set `Status=Done` and close issue.
7. **Verify board membership explicitly** before ending the task.

### Mandatory CLI sequence (safe quoting)
```bash
# 1) Create issue (single-quote title to avoid zsh brace expansion)
gh issue create --repo moldovancsaba/mvp-factory-control \
  --title '{reply}: <short description>' \
  --body-file /tmp/issue.md

# 2) Add to Project 1 (MANDATORY)
gh project item-add 1 --owner moldovancsaba --url <issue-url>

# 3) Verify item is on board (use high limit; default 30 can hide items)
gh project item-list 1 --owner moldovancsaba -L 500 --format json
```

### Prohibited
- Do not create or manage issues in `moldovancsaba/reply`.
- Do not track tasks in local `IDEABANK.md`, `ROADMAP.md`, `TASKLIST.md`, or similar files.
- Do not leave an issue only in GitHub Issues without adding it to Project 1.

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
| **Product** | Which app is this for? | Select `reply`, `amanoba`, etc. Strict separation. |
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

## Appendix: SSOT CLI Commands
**CRITICAL:** The default GitHub CLI `gh project item-list` does not expose custom board fields (like `product` or `status`) natively. To avoid JSON parse errors, always query the SSOT repo directly using `gh issue list`.

```bash
# 1) Find YOUR currently assigned SSOT issues
gh issue list --repo moldovancsaba/mvp-factory-control --state open --assignee "@me" --search "{reply}" --limit 10

# 2) View all open {reply} issues
gh issue list --repo moldovancsaba/mvp-factory-control --state open --search "{reply}" --limit 50 --json number,title,state,assignees

# 3) View details of a specific issue number
gh issue view <issue-number> --repo moldovancsaba/mvp-factory-control
```

## Current Security Workstream Tracking (2026-02-18)
- Active issues:
  - `mvp-factory-control#199` (`{reply}: Adopt OpenClaw security policy + approvals baseline`)
  - `mvp-factory-control#202` (`{reply}: Implement omnichannel routing + human-gated NBA orchestration`)
- Mandatory verification for this workstream:
```bash
cd /Users/moldovancsaba/Projects/reply
/opt/homebrew/bin/node chat/security-audit.js
/opt/homebrew/bin/node chat/security-audit.js --fix
```
