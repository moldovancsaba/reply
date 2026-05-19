"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveWorkspaceState,
  deriveWorkspaceOwnership,
  deriveWorkspaceAge,
  normalizeWorkspaceQueue,
  normalizeWorkspaceChannel,
  normalizeWorkspaceOwnerScope,
  buildWorkspaceMeta,
} = require("../routes/messaging.js");

function makeItem(overrides = {}) {
  return {
    handle: "alice@example.com",
    channel: "email",
    channels: ["email"],
    countIn: 1,
    countOut: 0,
    contact: {
      status: "open",
      draft: "",
      pendingSuggestions: [],
    },
    latestMessageAt: "2026-05-10T10:00:00.000Z",
    latestInboundAt: "2026-05-10T10:00:00.000Z",
    latestOutboundAt: null,
    ...overrides,
  };
}

test("workspace queue defaults inbound conversations to needs_reply", () => {
  const state = deriveWorkspaceState(makeItem());
  assert.equal(state.queueKey, "needs_reply");
  assert.equal(state.latestDirection, "inbound");
});

test("workspace queue prefers draft_ready when a draft or pending suggestion exists", () => {
  const withDraft = deriveWorkspaceState(makeItem({
    contact: { status: "open", draft: "Ready to send", pendingSuggestions: [] },
  }));
  assert.equal(withDraft.queueKey, "draft_ready");

  const withPending = deriveWorkspaceState(makeItem({
    contact: {
      status: "open",
      draft: "",
      pendingSuggestions: [{ id: "s1", status: "pending", content: "Draft" }],
    },
  }));
  assert.equal(withPending.queueKey, "draft_ready");
});

test("workspace queue treats outbound-latest conversations as waiting_on_contact", () => {
  const state = deriveWorkspaceState(makeItem({
    countIn: 1,
    countOut: 2,
    latestInboundAt: "2026-05-10T09:00:00.000Z",
    latestOutboundAt: "2026-05-10T10:00:00.000Z",
  }));
  assert.equal(state.queueKey, "waiting_on_contact");
  assert.equal(state.latestDirection, "outbound");
});

test("workspace queue respects resolved contact status", () => {
  const state = deriveWorkspaceState(makeItem({
    contact: { status: "closed", draft: "", pendingSuggestions: [] },
    closedAt: "2026-05-10T10:01:00.000Z",
  }));
  assert.equal(state.queueKey, "resolved");
  assert.equal(state.isResolved, true);
});

test("workspace queue promotes escalated conversations into their own lane", () => {
  const state = deriveWorkspaceState(makeItem({
    customerFlags: ["vip", "escalated"],
    contact: { status: "open", draft: "Ready", pendingSuggestions: [] },
  }));
  assert.equal(state.queueKey, "escalated");
  assert.deepEqual(state.customerFlags, ["vip", "escalated"]);
});

test("workspace filter normalization falls back safely", () => {
  assert.equal(normalizeWorkspaceQueue("draft_ready"), "draft_ready");
  assert.equal(normalizeWorkspaceQueue("escalated"), "escalated");
  assert.equal(normalizeWorkspaceQueue("not-real"), "all");
  assert.equal(normalizeWorkspaceChannel("whatsapp"), "whatsapp");
  assert.equal(normalizeWorkspaceChannel(""), "all");
  assert.equal(normalizeWorkspaceOwnerScope("mine"), "mine");
  assert.equal(normalizeWorkspaceOwnerScope("not-real"), "all");
});

test("workspace ownership derives mine, team, and unassigned scopes", () => {
  assert.equal(deriveWorkspaceOwnership(makeItem({ owner: "cs" }), "cs").ownershipKey, "mine");
  assert.equal(deriveWorkspaceOwnership(makeItem({ owner: "sales" }), "cs").ownershipKey, "team");
  assert.equal(deriveWorkspaceOwnership(makeItem({ owner: "" }), "cs").ownershipKey, "unassigned");
});

test("workspace age derives pending age for actionable queues", () => {
  const state = deriveWorkspaceState(makeItem({
    latestInboundAt: "2026-05-09T09:00:00.000Z",
    latestMessageAt: "2026-05-09T09:00:00.000Z",
  }));
  const age = deriveWorkspaceAge({ ...makeItem(), workspace: state }, Date.parse("2026-05-10T10:00:00.000Z"));
  assert.equal(age.actionable, true);
  assert.equal(age.pendingSinceAt, "2026-05-09T09:00:00.000Z");
  assert.equal(age.ageBucket, "over_24h");
  assert.equal(age.ageHours, 25);
});

test("workspace age treats escalated conversations as actionable", () => {
  const state = deriveWorkspaceState(makeItem({
    customerFlags: ["escalated"],
    latestInboundAt: "2026-05-09T09:00:00.000Z",
    latestMessageAt: "2026-05-09T09:00:00.000Z",
  }));
  const age = deriveWorkspaceAge({ ...makeItem(), workspace: state }, Date.parse("2026-05-10T10:00:00.000Z"));
  assert.equal(state.queueKey, "escalated");
  assert.equal(age.actionable, true);
  assert.equal(age.ageHours, 25);
});

test("workspace meta returns stable queue and channel counts", () => {
  const nowMs = Date.parse("2026-05-10T10:00:00.000Z");
  const items = [
    {
      ...makeItem({
        owner: "cs",
        latestInboundAt: "2026-05-09T08:30:00.000Z",
        latestMessageAt: "2026-05-09T08:30:00.000Z",
        customerFlags: ["escalated"],
      }),
      workspace: {
        queueKey: "escalated",
        pendingSinceAt: "2026-05-09T08:30:00.000Z",
      },
      workspaceOwnership: { ownershipKey: "mine" },
      workspaceAge: { actionable: true, ageHours: 25.5 },
    },
    {
      ...makeItem({
        owner: "sales",
        channel: "whatsapp",
        channels: ["whatsapp"],
        latestMessageAt: "2026-05-10T08:00:00.000Z",
        contact: { status: "open", draft: "Ready", pendingSuggestions: [] },
      }),
      workspace: {
        queueKey: "draft_ready",
        pendingSinceAt: "2026-05-10T08:00:00.000Z",
      },
      workspaceOwnership: { ownershipKey: "team" },
      workspaceAge: { actionable: true, ageHours: 2 },
    },
    {
      ...makeItem({
        owner: "",
        channel: "email",
        channels: ["email"],
        latestMessageAt: "2026-05-09T06:00:00.000Z",
        contact: { status: "open", draft: "Ready", pendingSuggestions: [] },
      }),
      workspace: {
        queueKey: "draft_ready",
        pendingSinceAt: "2026-05-09T06:00:00.000Z",
      },
      workspaceOwnership: { ownershipKey: "unassigned" },
      workspaceAge: { actionable: true, ageHours: 28 },
    },
    {
      ...makeItem({
        owner: "ops",
        channel: "email",
        channels: ["email"],
        countIn: 1,
        countOut: 2,
        latestInboundAt: "2026-05-10T09:00:00.000Z",
        latestOutboundAt: "2026-05-10T10:00:00.000Z",
      }),
      workspace: {
        queueKey: "waiting_on_contact",
        pendingSinceAt: "2026-05-10T10:00:00.000Z",
      },
      workspaceOwnership: { ownershipKey: "team" },
      workspaceAge: { actionable: false, ageHours: 0 },
    },
    {
      ...makeItem({ owner: "", channel: "email", channels: ["email"], contact: { status: "closed", draft: "", pendingSuggestions: [] }, closedAt: "2026-05-10T10:01:00.000Z" }),
      workspace: { queueKey: "resolved" },
      workspaceOwnership: { ownershipKey: "unassigned" },
      workspaceAge: { actionable: false, ageHours: 0 },
    },
  ];
  const meta = buildWorkspaceMeta(items, { queue: "draft_ready", channel: "whatsapp", ownerScope: "mine", ownerIdentity: "cs", nowMs });
  assert.equal(meta.queue, "draft_ready");
  assert.equal(meta.channel, "whatsapp");
  assert.equal(meta.ownerScope, "mine");
  assert.equal(meta.ownerIdentity, "cs");
  assert.deepEqual(
    meta.slaSegments.map((entry) => [entry.key, entry.count]),
    [
      ["needs_reply_over_1h", 0],
      ["needs_reply_over_24h", 0],
      ["draft_ready_over_1h", 2],
      ["draft_ready_over_24h", 1],
    ]
  );
  assert.deepEqual(
    meta.workloadSegments.map((entry) => [entry.key, entry.count]),
    [
      ["escalated_total", 1],
      ["mine_needs_reply", 0],
      ["mine_draft_ready", 0],
      ["unassigned_needs_reply", 0],
      ["unassigned_draft_ready", 1],
      ["team_needs_reply", 0],
      ["team_waiting_on_contact", 1],
    ]
  );
  assert.deepEqual(
    meta.availableOwnerScopes.map((entry) => [entry.key, entry.count]),
    [
      ["all", 5],
      ["mine", 1],
      ["team", 2],
      ["unassigned", 2],
    ]
  );
  assert.deepEqual(
    meta.availableQueues.map((entry) => [entry.key, entry.count]),
    [
      ["all", 5],
      ["escalated", 1],
      ["needs_reply", 0],
      ["draft_ready", 2],
      ["waiting_on_contact", 1],
      ["resolved", 1],
    ]
  );
  assert.deepEqual(
    meta.availableChannels.map((entry) => [entry.key, entry.count]),
    [
      ["all", 5],
      ["email", 4],
      ["whatsapp", 1],
    ]
  );
});
