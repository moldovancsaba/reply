"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  appendThreadMessages,
  buildThreadCursor,
  cacheThreadSnapshot,
  getThreadDelta,
  parseThreadCursor,
} = require("../thread-hot-cache.js");

test("thread hot cache builds and parses cursors", () => {
  const cursor = buildThreadCursor([
    { id: "m1", text: "one", date: "2026-05-25T10:00:00.000Z" },
    { id: "m2", text: "two", date: "2026-05-25T10:01:00.000Z" },
  ]);
  const parsed = parseThreadCursor(cursor);
  assert.equal(parsed.timestampMs, Date.parse("2026-05-25T10:01:00.000Z"));
  assert.equal(parsed.key, "m2");
});

test("thread hot cache returns only unseen delta messages", () => {
  cacheThreadSnapshot("alice@example.com", {
    newestMessages: [
      { id: "m1", text: "one", date: "2026-05-25T10:00:00.000Z" },
      { id: "m2", text: "two", date: "2026-05-25T10:01:00.000Z" },
    ],
  });
  const cursor = buildThreadCursor([
    { id: "m2", text: "two", date: "2026-05-25T10:01:00.000Z" },
  ]);
  appendThreadMessages("alice@example.com", [
    { id: "m3", text: "three", date: "2026-05-25T10:02:00.000Z" },
  ]);
  const delta = getThreadDelta("alice@example.com", cursor);
  assert.equal(delta.messages.length, 1);
  assert.equal(delta.messages[0].id, "m3");
});
