"use strict";

/** reply#31 — `/api/conversations` `meta` contract (via exported sort helpers from `routes/messaging.js`). */
const test = require("node:test");
const assert = require("node:assert");

const {
  normalizeConversationSort,
  CONVERSATION_SORT_MODES,
} = require("../routes/messaging.js");

test("conversations API meta: unknown sort falls back to newest", () => {
  assert.equal(normalizeConversationSort("not-a-real-mode"), "newest");
});

test("conversations API meta: stable keys (no legacy mode fallback field)", () => {
  const sortRaw = "newest";
  const meta = {
    sort: normalizeConversationSort(sortRaw),
    sortRequested: sortRaw,
    sortValid: CONVERSATION_SORT_MODES.has(String(sortRaw || "").toLowerCase().trim()),
  };
  assert.deepEqual(Object.keys(meta).sort(), ["sort", "sortRequested", "sortValid"]);
  assert.equal("mode" in meta, false);
  assert.equal(meta.sort, "newest");
  assert.equal(meta.sortValid, true);
});
