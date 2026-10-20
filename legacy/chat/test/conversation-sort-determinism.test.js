"use strict";

/** reply#15 — deterministic ordering + recommendation traces (tie-breaks, sanitize). */
const test = require("node:test");
const assert = require("node:assert");

const {
  applyConversationSort,
  resolveConversationTimestamps,
  sanitizeConversationItemForApi,
} = require("../routes/messaging.js");

function baseItem(overrides) {
  return {
    handle: "h",
    displayName: "Zed",
    sortTime: 1000,
    firstTimestamp: 500,
    count: 10,
    countIn: 4,
    countOut: 6,
    ...overrides,
  };
}

test("newest: later sortTime first; tie-break by displayName", () => {
  const items = [
    baseItem({ handle: "b", displayName: "Bob", sortTime: 100 }),
    baseItem({ handle: "a", displayName: "Amy", sortTime: 200 }),
    baseItem({ handle: "c", displayName: "Zed", sortTime: 200 }),
  ];
  const copy = items.map((x) => ({ ...x }));
  applyConversationSort(copy, "newest", 10_000);
  assert.deepEqual(
    copy.map((x) => x.handle),
    ["a", "c", "b"]
  );
});

test("oldest: earlier firstTimestamp first", () => {
  const items = [
    baseItem({ handle: "x", firstTimestamp: 300, sortTime: 900 }),
    baseItem({ handle: "y", firstTimestamp: 100, sortTime: 800 }),
  ];
  const copy = items.map((x) => ({ ...x }));
  applyConversationSort(copy, "oldest", 10_000);
  assert.deepEqual(
    copy.map((x) => x.handle),
    ["y", "x"]
  );
});

test("volume_in / volume_out / volume_total order by counts", () => {
  const items = [
    baseItem({ handle: "lo", countIn: 1, countOut: 9, count: 10 }),
    baseItem({ handle: "hi", countIn: 8, countOut: 1, count: 9 }),
  ];
  const inCopy = items.map((x) => ({ ...x }));
  applyConversationSort(inCopy, "volume_in", 10_000);
  assert.equal(inCopy[0].handle, "hi");

  const outCopy = items.map((x) => ({ ...x }));
  applyConversationSort(outCopy, "volume_out", 10_000);
  assert.equal(outCopy[0].handle, "lo");

  const tot = [
    baseItem({ handle: "a", count: 5 }),
    baseItem({ handle: "b", count: 20 }),
  ];
  applyConversationSort(tot, "volume_total", 10_000);
  assert.equal(tot[0].handle, "b");
});

test("recommendation: attaches _rankTrace and sanitize strips it for non-recommendation sort", () => {
  const items = [
    baseItem({ handle: "a", displayName: "A", sortTime: 5000, count: 3, firstTimestamp: 1000 }),
    baseItem({ handle: "b", displayName: "B", sortTime: 8000, count: 12, firstTimestamp: 2000 }),
  ];
  const copy = items.map((x) => ({ ...x }));
  applyConversationSort(copy, "recommendation", 20_000);
  const withTrace = copy.find((x) => x.handle === "b");
  assert.ok(withTrace && withTrace._rankTrace);
  assert.ok(typeof withTrace._rankTrace.score === "number");

  const sanitizedNewest = sanitizeConversationItemForApi({ ...withTrace }, "newest");
  assert.equal(sanitizedNewest._rankTrace, undefined);

  const sanitizedRec = sanitizeConversationItemForApi({ ...withTrace }, "recommendation");
  assert.ok(sanitizedRec._rankTrace);
});

test("resolveConversationTimestamps prefers embedded bracket date over import timestamp", () => {
  const out = resolveConversationTimestamps({
    timestamp: "2026-05-01T19:18:00.245Z",
    first_timestamp: "2026-05-01T19:18:00.245Z",
    text: "[Monday, 13 December 2021 at 17:15:58] Note: legacy import",
  });
  assert.ok(String(out.previewDate || "").startsWith("2021-12-13T"));
  assert.notEqual(out.latestTimestamp, Date.parse("2026-05-01T19:18:00.245Z"));
});
