"use strict";

/** reply#31 — `hub-runtime` listen info + static wiring check for `/api/health` fields. */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const hubRuntime = require("../hub-runtime.js");

test("hub-runtime listen info used by /api/health", () => {
  hubRuntime.setListenInfo(null, "127.0.0.1");
  assert.deepEqual(hubRuntime.getListenInfo(), { httpPort: null, httpHost: "127.0.0.1" });
  hubRuntime.setListenInfo(45311, "0.0.0.0");
  assert.deepEqual(hubRuntime.getListenInfo(), { httpPort: 45311, httpHost: "0.0.0.0" });
  hubRuntime.setListenInfo(null, "127.0.0.1");
});

test("system health route wires httpPort from hub-runtime", () => {
  const src = fs.readFileSync(path.join(__dirname, "../routes/system.js"), "utf8");
  assert.ok(src.includes("hubRuntime.getListenInfo()"), "health should read hub listen info");
  assert.ok(/\bhttpPort\b/.test(src), "health payload should expose httpPort");
  assert.ok(/\bhttpHost\b/.test(src), "health payload should expose httpHost");
});
