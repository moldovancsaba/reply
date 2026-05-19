"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  summarizeUnifiedProfile,
  buildRecentActivityTimeline,
} = require("../routes/kyc.js");

test("summarizeUnifiedProfile combines aliases, identities, channels, and conversation stats", () => {
  const summary = summarizeUnifiedProfile({
    handle: "alice@example.com",
    contact: {
      id: "c1",
      handle: "alice@example.com",
      displayName: "Alice",
      owner: "cs",
      customerFlags: ["vip", "renewal"],
      lastContacted: "2026-05-10T11:00:00.000Z",
      status: "open",
      channels: {
        email: ["alice@example.com"],
        phone: ["+36701234567"],
        linkedin: ["https://linkedin.com/in/alice"],
      },
    },
    aliases: [
      { id: "a1", handle: "+36701234567" },
    ],
    handles: ["alice@example.com", "+36701234567"],
    conversationSummaries: [
      {
        conversationId: "conv-1",
        channels: ["email", "whatsapp"],
        allowedChannels: ["email"],
        latestMessageAt: "2026-05-10T10:00:00.000Z",
        latestInboundAt: "2026-05-10T10:00:00.000Z",
        latestOutboundAt: "2026-05-10T09:00:00.000Z",
      },
      {
        conversationId: "conv-2",
        channels: ["imessage"],
        allowedChannels: ["imessage"],
        latestMessageAt: "2026-05-10T11:00:00.000Z",
        latestInboundAt: "2026-05-10T08:00:00.000Z",
        latestOutboundAt: "2026-05-10T11:00:00.000Z",
      },
    ],
    recentRows: [
      { handle: "+36701234567", source: "whatsapp", path: "whatsapp://+36701234567" },
    ],
  });

  assert.equal(summary.canonicalContactId, "c1");
  assert.equal(summary.aliasCount, 1);
  assert.equal(summary.identityCount, 3);
  assert.equal(summary.conversationCount, 2);
  assert.equal(summary.owner, "cs");
  assert.deepEqual(summary.customerFlags, ["vip", "renewal"]);
  assert.deepEqual(summary.allowedChannels, ["email", "imessage"]);
  assert.deepEqual(summary.channelCoverage, ["email", "imessage", "linkedin", "whatsapp"]);
  assert.equal(summary.latestActiveAt, "2026-05-10T11:00:00.000Z");
  assert.equal(summary.latestInboundAt, "2026-05-10T10:00:00.000Z");
  assert.equal(summary.latestOutboundAt, "2026-05-10T11:00:00.000Z");
});

test("buildRecentActivityTimeline returns newest-first unified activity events", () => {
  const timeline = buildRecentActivityTimeline({
    handle: "alice@example.com",
    contact: {
      verifiedChannels: {
        "alice@example.com": "2026-05-10T09:59:00.000Z",
      },
    },
    aliases: [
      {
        id: "a1",
        handle: "+36701234567",
        displayName: "Alice Mobile",
        lastChannel: "imessage",
        lastContacted: "2026-05-10T09:58:00.000Z",
      },
    ],
    recentRows: [
      {
        handle: "alice@example.com",
        text: "Latest inbound message",
        timestamp: "2026-05-10T10:00:00.000Z",
        path: "mailto:alice@example.com",
        is_from_me: 0,
      },
      {
        handle: "alice@example.com",
        text: "Previous outbound message",
        timestamp: "2026-05-10T09:57:00.000Z",
        path: "mailto:alice@example.com",
        is_from_me: 1,
      },
    ],
  });

  assert.equal(timeline.length, 4);
  assert.deepEqual(
    timeline.map((entry) => [entry.kind, entry.direction, entry.occurredAt]),
    [
      ["message", "inbound", "2026-05-10T10:00:00.000Z"],
      ["channel_verified", "system", "2026-05-10T09:59:00.000Z"],
      ["alias_linked", "system", "2026-05-10T09:58:00.000Z"],
      ["message", "outbound", "2026-05-10T09:57:00.000Z"],
    ]
  );
});
