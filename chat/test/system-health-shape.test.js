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

test("hub-runtime exposes bootstrap launch state for native startup", () => {
  hubRuntime.resetBootstrap("initializing", "Initializing hub...");
  const initial = hubRuntime.getBootstrapState();
  assert.equal(initial.stage, "initializing");
  assert.equal(initial.ready, false);
  assert.equal(initial.readyAt, null);
  assert.equal(initial.message, "Initializing hub...");
  assert.ok(initial.startedAt, "bootstrap state should include a startup timestamp");

  hubRuntime.setBootstrapStage("listening", "HTTP interface ready.");
  const listening = hubRuntime.getBootstrapState();
  assert.equal(listening.stage, "listening");
  assert.equal(listening.ready, false);

  hubRuntime.markBootstrapReady("Local runtime is ready.");
  const ready = hubRuntime.getBootstrapState();
  assert.equal(ready.stage, "ready");
  assert.equal(ready.ready, true);
  assert.equal(ready.message, "Local runtime is ready.");
  assert.ok(ready.readyAt, "ready bootstrap state should include a ready timestamp");
});

test("system health route imports message-store for materialized conversation stats", () => {
  const src = fs.readFileSync(path.join(__dirname, "../routes/system.js"), "utf8");
  assert.ok(src.includes('require("../message-store")'), "health should import message-store");
  assert.ok(src.includes("getConversationIndexStats"), "health should read materialized conversation stats");
});

test("system health attaches preflight + api contract", () => {
  const src = fs.readFileSync(path.join(__dirname, "../routes/system.js"), "utf8");
  assert.ok(src.includes("health.preflight"), "health should include preflight report");
  assert.ok(src.includes("health.apiContract"), "health should include apiContract for clients");
  assert.ok(src.includes("servePreflight"), "/api/preflight route handler should exist");
  assert.ok(src.includes("launch: hubRuntime.getBootstrapState()"), "health should include launch bootstrap state");
});

test("server initializes conversation foundation schema during startup", () => {
  const src = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  assert.ok(src.includes('require("./conversation-foundation-store.js")'), "server should load conversation foundation store");
  assert.ok(src.includes("conversationFoundationStore.waitUntilReady()"), "server startup should initialize conversation foundation schema");
});
