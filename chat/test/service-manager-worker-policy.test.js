"use strict";

/** reply#31 — duplicate worker / fast exit-0 detection (`service-manager.js`). */
const test = require("node:test");
const assert = require("node:assert");

const sm = require("../service-manager.js");

test("worker duplicate early-exit: detects suspicious fast exit-0", () => {
  assert.equal(sm.isWorkerEarlyExitDuplicateCandidate("worker", 0, null, 100), true);
  assert.equal(sm.isWorkerEarlyExitDuplicateCandidate("worker", 0, undefined, 100), true);
});

test("worker duplicate early-exit: SIGTERM is not duplicate", () => {
  assert.equal(sm.isWorkerEarlyExitDuplicateCandidate("worker", 0, "SIGTERM", 100), false);
});

test("worker duplicate early-exit: non-zero exit is not duplicate", () => {
  assert.equal(sm.isWorkerEarlyExitDuplicateCandidate("worker", 1, null, 100), false);
});

test("worker duplicate early-exit: long uptime is not duplicate", () => {
  assert.equal(sm.isWorkerEarlyExitDuplicateCandidate("worker", 0, null, 60_000), false);
});

test("worker duplicate early-exit: other services ignored", () => {
  assert.equal(sm.isWorkerEarlyExitDuplicateCandidate("openclaw", 0, null, 100), false);
});
