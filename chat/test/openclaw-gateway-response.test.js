"use strict";

const test = require("node:test");
const assert = require("node:assert");

const { openclawGatewayResponseOk } = require("../openclaw-gateway-env.js");

test("openclawGatewayResponseOk: healthz live shape", () => {
  assert.strictEqual(openclawGatewayResponseOk({ ok: true, status: "live" }), true);
});

test("openclawGatewayResponseOk: status-only live", () => {
  assert.strictEqual(openclawGatewayResponseOk({ status: "live" }), true);
});

test("openclawGatewayResponseOk: rejects missing / offline", () => {
  assert.strictEqual(openclawGatewayResponseOk(null), false);
  assert.strictEqual(openclawGatewayResponseOk({ ok: false }), false);
  assert.strictEqual(openclawGatewayResponseOk({ status: "dead" }), false);
});
