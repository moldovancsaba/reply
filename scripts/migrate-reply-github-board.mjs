#!/usr/bin/env node
/**
 * Migrate MVP Factory Board (user project #1) cards with Product = {reply} to:
 * - Issues transferred into moldovancsaba/reply (requires owner token)
 * - Cards on user project #7 ({reply} board)
 * - Removes cards from project #1
 *
 * Recommended: one Classic PAT with **repo**, **project**, **read:project** (owner account):
 *   export GITHUB_TOKEN=ghp_...
 *   node scripts/migrate-reply-github-board.mjs
 *
 * Split mode (may fail if the bot user cannot modify your Project):
 * - CHAPPIE_TOKEN: read:project, project — list/add/delete project items
 * - OWNER_TOKEN: repo — transferIssue into moldovancsaba/reply
 *
 * Or: `gh auth token -u moldovancsaba` after `gh auth refresh -s project -s read:project`.
 *
 * After issues already live in `reply` but are off the board, add them to project #7:
 *   node scripts/migrate-reply-github-board.mjs --seed-project-7
 *
 * Project #7 **Status** matches MVP Factory columns (8 options). Option IDs below were set
 * via `updateProjectV2Field` (April 2026); re-fetch with GraphQL if you edit options in the UI.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Load repo-root `.env` into `process.env` (does not override existing vars). */
function loadRootEnv() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const p = join(root, ".env");
  if (!existsSync(p)) return;
  const raw = readFileSync(p, "utf8");
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadRootEnv();

const OWNER = "moldovancsaba";
const CONTROL = "mvp-factory-control";
const REPLY = "reply";
const PROJECT_SRC = 1;
const PROJECT_DST = 7;

const PROJECT_SRC_ID = "PVT_kwHOACGtF84BOtVF";
const PROJECT_DST_ID = "PVT_kwHOACGtF84BUIwt";
const STATUS_FIELD_DST = "PVTSSF_lAHOACGtF84BUIwtzhBS9T8";

/** Single-select option IDs on project #7 Status (MVP Factory column names) */
const STATUS_OPT = {
  ideaBank: "43c883bc",
  roadmap: "e4df9a08",
  backlog: "0c50da12",
  todoNext: "b06d2d84",
  inProgressNow: "155a596d",
  review: "195c9e3f",
  blocked: "f18453eb",
  done: "07309702",
};

const MVP_STATUS_TO_BUCKET = {
  "IDEA BANK": "ideaBank",
  "Roadmap (LATER)": "roadmap",
  "Backlog (SOONER)": "backlog",
  "Todo (NEXT)": "todoNext",
  "In Progress (NOW)": "inProgressNow",
  Review: "review",
  Blocked: "blocked",
  Done: "done",
};

function getUnifiedOrSplitTokens() {
  const u = (process.env.GITHUB_TOKEN || process.env.MIGRATION_TOKEN || "").trim();
  if (u) return { gql: u, transfer: u };
  let chap = (process.env.CHAPPIE_TOKEN || process.env.GH_TOKEN_CHAPPIE || "").trim();
  let own = (process.env.OWNER_TOKEN || process.env.GH_TOKEN_OWNER || "").trim();
  if (chap && own) return { gql: chap, transfer: own };
  try {
    own = own || execSync("gh auth token -u moldovancsaba", { encoding: "utf8" }).trim();
  } catch {
    throw new Error("Need moldovancsaba gh auth or OWNER_TOKEN for transferIssue.");
  }
  try {
    chap = chap || execSync("gh auth token -u agent-chappie", { encoding: "utf8" }).trim();
    return { gql: chap, transfer: own };
  } catch {
    /* no bot account: single owner token (needs project + read:project on PAT) */
    return { gql: own, transfer: own };
  }
}

async function gql(token, query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (body.message && body.data == null && !body.errors) {
    throw new Error(`${body.message}${res.status ? ` (HTTP ${res.status})` : ""}`);
  }
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  if (body.data == null) {
    throw new Error("GraphQL returned no data");
  }
  return body.data;
}

function extractFields(fieldNodes) {
  const out = {};
  for (const n of fieldNodes || []) {
    if (n?.field?.name && n?.name) out[n.field.name] = n.name;
  }
  return out;
}

async function listReplyItemsFromProject1(chapToken) {
  const items = [];
  let cursor = null;
  const q = `
    query($cursor: String) {
      user(login: "${OWNER}") {
        projectV2(number: ${PROJECT_SRC}) {
          items(first: 100, after: $cursor) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id
              content {
                __typename
                ... on Issue {
                  id
                  number
                  title
                  repository { name owner { login } }
                }
              }
              fieldValues(first: 30) {
                nodes {
                  ... on ProjectV2ItemFieldSingleSelectValue {
                    name
                    field { ... on ProjectV2SingleSelectField { name } }
                  }
                }
              }
            }
          }
        }
      }
    }`;
  for (;;) {
    const data = await gql(chapToken, q, { cursor });
    const conn = data.user.projectV2.items;
    for (const node of conn.nodes) {
      if (node.content?.__typename !== "Issue") continue;
      const fields = extractFields(node.fieldValues?.nodes);
      if (fields.Product !== "{reply}") continue;
      const repo = node.content.repository;
      if (repo.owner.login !== OWNER) continue;
      if (repo.name !== CONTROL && repo.name !== REPLY) continue;
      items.push({
        projectItemId: node.id,
        issueNodeId: node.content.id,
        issueNumber: node.content.number,
        title: node.content.title,
        status: fields.Status || "Todo (NEXT)",
        sourceRepo: repo.name,
      });
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
  }
  return items;
}

async function getReplyRepoId(token) {
  const data = await gql(
    token,
    `query { repository(owner: "${OWNER}", name: "${REPLY}") { id } }`
  );
  return data.repository.id;
}

async function transferIssue(transferToken, issueId, targetRepoId) {
  const data = await gql(
    transferToken,
    `mutation($issueId: ID!, $repoId: ID!) {
      transferIssue(input: { issueId: $issueId, repositoryId: $repoId }) {
        issue { id number url }
      }
    }`,
    { issueId, repoId: targetRepoId }
  );
  return data.transferIssue.issue;
}

async function addToProject(chapToken, contentId) {
  const data = await gql(
    chapToken,
    `mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
        item { id }
      }
    }`,
    { projectId: PROJECT_DST_ID, contentId }
  );
  return data.addProjectV2ItemById.item.id;
}

async function setStatus(chapToken, itemId, optionId) {
  await gql(
    chapToken,
    `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(
        input: {
          projectId: $projectId
          itemId: $itemId
          fieldId: $fieldId
          value: { singleSelectOptionId: $optionId }
        }
      ) { projectV2Item { id } }
    }`,
    {
      projectId: PROJECT_DST_ID,
      itemId,
      fieldId: STATUS_FIELD_DST,
      optionId,
    }
  );
}

async function removeFromProject(chapToken, itemId) {
  await gql(
    chapToken,
    `mutation($projectId: ID!, $itemId: ID!) {
      deleteProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
        deletedItemId
      }
    }`,
    { projectId: PROJECT_SRC_ID, itemId }
  );
}

function getChappieTokenForProjectRead() {
  const t = (process.env.CHAPPIE_TOKEN || process.env.GH_TOKEN_CHAPPIE || "").trim();
  if (t) return t;
  return execSync("gh auth token -u agent-chappie", { encoding: "utf8" }).trim();
}

/**
 * Remove {reply} cards from MVP Factory Project #1 only (no transfer / no add).
 * Uses agent-chappie (or CHAPPIE_TOKEN): that account can delete items but often cannot AddProjectV2ItemById on the owner's project #7.
 */
async function removeReplyCardsFromP1Only() {
  const gqlTok = getChappieTokenForProjectRead();
  console.error("Listing {reply} issues on MVP Factory project #1…");
  const rows = await listReplyItemsFromProject1(gqlTok);
  console.error(`Removing ${rows.length} project cards from project #1…`);
  for (const row of rows) {
    await removeFromProject(gqlTok, row.projectItemId);
    console.error(`  removed card ${row.projectItemId} (issue #${row.issueNumber} in ${row.sourceRepo})`);
  }
  console.error("Project #1 cleanup done.");
}

/**
 * Add existing `moldovancsaba/reply` issues to user project #7 and set Status from issue state:
 * OPEN -> Todo (NEXT), CLOSED -> Done. (MVP column metadata was lost when cards left project #1.)
 *
 * Usage:
 *   node scripts/migrate-reply-github-board.mjs --seed-project-7
 *   node scripts/migrate-reply-github-board.mjs --seed-project-7 13 14 15
 */
async function seedProject7FromReplyIssues(gqlTok, issueNumbers) {
  console.error(
    `Adding ${issueNumbers.length} issue(s) to project #${PROJECT_DST} (${REPLY})…`
  );
  for (const num of issueNumbers) {
    const data = await gql(
      gqlTok,
      `query($owner: String!, $name: String!, $n: Int!) {
        repository(owner: $owner, name: $name) {
          issue(number: $n) { id title state }
        }
      }`,
      { owner: OWNER, name: REPLY, n: num }
    );
    const issue = data.repository?.issue;
    if (!issue) {
      console.error(`  #${num} not found, skip`);
      continue;
    }
    const bucket = issue.state === "CLOSED" ? "done" : "todoNext";
    const opt = STATUS_OPT[bucket];
    try {
      const itemId = await addToProject(gqlTok, issue.id);
      await setStatus(gqlTok, itemId, opt);
      const short =
        issue.title.length > 56 ? `${issue.title.slice(0, 56)}…` : issue.title;
      const label =
        bucket === "done"
          ? "Done"
          : bucket === "todoNext"
            ? "Todo (NEXT)"
            : bucket;
      console.error(`  #${num} ${short} -> ${label}`);
    } catch (e) {
      const msg = String(e.message || e);
      if (/already|exists in this project|duplicate/i.test(msg)) {
        console.error(`  #${num} already on project #${PROJECT_DST}, skip`);
        continue;
      }
      throw e;
    }
  }
  console.error("Project #7 seed done.");
}

function parseSeedIssueNumbers(argv) {
  const idx = argv.indexOf("--seed-project-7");
  const tail = argv.slice(idx + 1).filter((a) => !a.startsWith("--"));
  if (!tail.length) {
    const out = [];
    for (let n = 13; n <= 28; n++) out.push(n);
    return out;
  }
  const nums = [];
  for (const chunk of tail.join(" ").split(/[\s,]+/)) {
    const n = parseInt(chunk, 10);
    if (n > 0) nums.push(n);
  }
  return nums;
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  if (process.argv.includes("--remove-from-p1-only")) {
    await removeReplyCardsFromP1Only();
    return;
  }
  if (process.argv.includes("--seed-project-7")) {
    const { gql: gqlTok } = getUnifiedOrSplitTokens();
    await seedProject7FromReplyIssues(gqlTok, parseSeedIssueNumbers(process.argv));
    return;
  }

  const { gql: gqlTok, transfer: xferTok } = getUnifiedOrSplitTokens();

  console.error("Listing {reply} issues from MVP Factory project…");
  const rows = await listReplyItemsFromProject1(gqlTok);
  console.error(`Found ${rows.length} items (issues in ${CONTROL} with Product {reply}).`);
  if (dry) {
    for (const r of rows) {
      console.log(JSON.stringify(r, null, 2));
    }
    return;
  }

  const replyRepoId = await getReplyRepoId(xferTok);

  for (const row of rows) {
    const bucket = MVP_STATUS_TO_BUCKET[row.status] || "todoNext";
    const opt = STATUS_OPT[bucket];
    process.stderr.write(
      `#${row.issueNumber} ${row.title.slice(0, 60)}… [${row.status} -> ${bucket}]\n`
    );
    let issueId = row.issueNodeId;
    let issueNum = row.issueNumber;
    if (row.sourceRepo === REPLY) {
      process.stderr.write(`  already in ${REPLY}#${issueNum}, skip transfer\n`);
    } else {
      try {
        const transferred = await transferIssue(xferTok, issueId, replyRepoId);
        issueId = transferred.id;
        issueNum = transferred.number;
        process.stderr.write(`  transferred -> ${REPLY}#${issueNum}\n`);
      } catch (e) {
        const msg = String(e.message || e);
        if (/same repository|already been transferred/i.test(msg)) {
          process.stderr.write(`  transfer skipped: ${msg}\n`);
        } else {
          throw e;
        }
      }
    }

    const newItemId = await addToProject(gqlTok, issueId);
    await setStatus(gqlTok, newItemId, opt);
    await removeFromProject(gqlTok, row.projectItemId);
    process.stderr.write(`  added to project ${PROJECT_DST}, removed from project ${PROJECT_SRC}\n`);
  }
  console.error("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
