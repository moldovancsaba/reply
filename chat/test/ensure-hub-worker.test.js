"use strict";

/** reply#31 — `ensure-hub-worker.js` PID file cleanup (temp dirs; no live worker). */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { ensureWorkerCanStartFromHub } = require("../ensure-hub-worker.js");

test("ensureWorkerCanStartFromHub removes worker.pid when PID is not running", () => {
  const chatDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-ehw-"));
  const dataDir = path.join(chatDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const pidFile = path.join(dataDir, "worker.pid");
  fs.writeFileSync(pidFile, "999999997\n", "utf8");
  ensureWorkerCanStartFromHub(chatDir);
  assert.equal(fs.existsSync(pidFile), false);
});

test("ensureWorkerCanStartFromHub removes worker.pid when contents are not a PID", () => {
  const chatDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-ehw-"));
  const dataDir = path.join(chatDir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const pidFile = path.join(dataDir, "worker.pid");
  fs.writeFileSync(pidFile, "not-a-pid\n", "utf8");
  ensureWorkerCanStartFromHub(chatDir);
  assert.equal(fs.existsSync(pidFile), false);
});
