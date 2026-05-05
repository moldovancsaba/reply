"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeThreadStoreRows } = require("../routes/messaging.js");

test("thread store normalization preserves canonical left/right semantics from SQLite rows", () => {
  const rows = [
    {
      id: "m1",
      text: "inbound mail",
      source: "Mail",
      handle: "alice@example.com",
      timestamp: "2026-05-01T10:00:00.000Z",
      path: "mailto:alice@example.com",
      is_from_me: 0,
    },
    {
      id: "m2",
      text: "outbound reply",
      source: "Mail",
      handle: "alice@example.com",
      timestamp: "2026-05-01T10:10:00.000Z",
      path: "mailto:alice@example.com",
      is_from_me: 1,
    },
  ];

  const out = normalizeThreadStoreRows(rows);
  assert.equal(out.length, 2);
  assert.deepEqual(
    out.map((m) => ({ id: m.id, role: m.role, is_from_me: m.is_from_me, channel: m.channel, text: m.text })),
    [
      { id: "m1", role: "contact", is_from_me: false, channel: "email", text: "inbound mail" },
      { id: "m2", role: "me", is_from_me: true, channel: "email", text: "outbound reply" },
    ]
  );
});
