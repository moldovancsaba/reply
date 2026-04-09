# Migrating `{reply}` work from MVP Factory Board → `{reply}` repo + Project

**Product decision:** `{reply}` delivery SSOT is **[`moldovancsaba/reply` issues](https://github.com/moldovancsaba/reply)** plus **[GitHub Project #7](https://github.com/users/moldovancsaba/projects/7)**. See [`PROJECT_MANAGEMENT.md`](PROJECT_MANAGEMENT.md).

This document describes **how to move** legacy cards that still sit on the [MVP Factory Board](https://github.com/users/moldovancsaba/projects/1/views/14) with **Product = `{reply}`** in [`moldovancsaba/mvp-factory-control`](https://github.com/moldovancsaba/mvp-factory-control) into the product repo and Project #7.

To **transfer issues** and **re-home project cards**, use the automation below.

## Prerequisites

1. **Issues enabled on `moldovancsaba/reply`**  
   GitHub rejects `transferIssue` if the destination repo has issues turned off. This was enabled for migration (April 2026). Confirm under repo **Settings → General → Features → Issues**.

2. **GitHub token scopes (Classic PAT recommended)**  
   The account that owns the projects must use a token with:

   - `repo`
   - `read:project`
   - `project`

   Store it only for the migration run:

   ```bash
   export GITHUB_TOKEN=ghp_your_pat_here
   ```

   To extend your logged-in `gh` session instead:

   ```bash
   gh auth switch -u moldovancsaba
   gh auth refresh -h github.com -s project -s read:project
   ```

   Complete the device flow in the browser, then run the script **without** `GITHUB_TOKEN` so it uses `gh auth token -u moldovancsaba`.

   **Note:** A bot or secondary GitHub user that is **not** a project admin will get `AddProjectV2ItemById` **forbidden** even with `project` scope. Use the **owner** token for the migration.

3. **Optional: match MVP Factory “Status” columns on project #7**  
   The MVP Factory board uses eight statuses: *IDEA BANK*, *Roadmap (LATER)*, *Backlog (SOONER)*, *Todo (NEXT)*, *In Progress (NOW)*, *Review*, *Blocked*, *Done*.  
   Project #7 shipped with only *Todo* / *In Progress* / *Done*. You can **edit the Status field** on project #7 in the GitHub UI to add the same options (recommended for parity).  

   Until then, [`scripts/migrate-reply-github-board.mjs`](../scripts/migrate-reply-github-board.mjs) **maps** MVP statuses onto the three columns:

   | MVP Factory status | Project #7 column |
   |--------------------|-------------------|
   | IDEA BANK, Roadmap (LATER), Backlog (SOONER), Todo (NEXT) | Todo |
   | In Progress (NOW), Review, Blocked | In Progress |
   | Done | Done |

   After you add the eight options in the UI, open the script and replace `STATUS_OPT` with the new **option IDs** from a quick GraphQL `fields` query (or ask `gh project field-list 7 --owner moldovancsaba --format json`).

## Run the migration

```bash
cd /path/to/reply   # this repository
export GITHUB_TOKEN=ghp_...   # optional if gh already has project scopes
node scripts/migrate-reply-github-board.mjs --dry-run   # preview
node scripts/migrate-reply-github-board.mjs             # execute
```

**If transfers already happened** but the owner token still lacks `project` / `read:project`, you can **only remove** `{reply}` cards from MVP Factory project #1 using **agent-chappie** (or any account that can read project #1 and delete items):

```bash
node scripts/migrate-reply-github-board.mjs --remove-from-p1-only
```

Then add the issues to project #7 **as the owner** after `gh auth refresh` (see Prerequisites), for example:

```bash
for n in 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28; do
  GITHUB_TOKEN="$(gh auth token -u moldovancsaba)" gh project item-add 7 --owner moldovancsaba \
    --url "https://github.com/moldovancsaba/reply/issues/$n"
done
```

(Use `gh auth switch -u moldovancsaba` first if `gh project` is picking the wrong logged-in user.)

The script will:

1. List every **issue** on **user project #1** whose **Product** single-select is **`{reply}`** (from `mvp-factory-control` or already in `reply`).
2. **Transfer** each issue from `mvp-factory-control` → `moldovancsaba/reply` (no-op if already in `reply`).
3. **Add** the issue to **user project #7** and set **Status** using the mapping above.
4. **Remove** the card from **user project #1** (move, not copy).

## Already done in this environment

- **Issues** were enabled on [`moldovancsaba/reply`](https://github.com/moldovancsaba/reply) so transfers are allowed.
- **Batch transfer** (April 2026): MVP Factory control issues were moved into **`moldovancsaba/reply`** as **#13–#28** (see issue list in the repo).
- **MVP Factory project #1:** all `{reply}` **cards were removed** via `node scripts/migrate-reply-github-board.mjs --remove-from-p1-only` (uses **agent-chappie** for `deleteProjectV2Item`).
- **Still on you (owner token):** add **reply #13–#28** to [project #7](https://github.com/users/moldovancsaba/projects/7) after `gh auth refresh -s project -s read:project` (or a Classic PAT with those scopes). `AddProjectV2ItemById` fails for **agent-chappie** and for **moldovancsaba** until those scopes are granted. Optionally set **Status** on each card in the UI or extend the main migration script to run **add + status** once the token works.

## References

- Control repo: [moldovancsaba/mvp-factory-control](https://github.com/moldovancsaba/mvp-factory-control)
- MVP Factory Board (view 14): [projects/1/views/14](https://github.com/users/moldovancsaba/projects/1/views/14)
- `{reply}` Project: [projects/7](https://github.com/users/moldovancsaba/projects/7)
- GitHub docs: [Using the API to manage Projects](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-a-project)
