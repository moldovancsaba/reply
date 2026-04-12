"use strict";

/** reply#30 — hub port list for LinkedIn extension / userscript. */
const test = require("node:test");
const assert = require("node:assert");
const {
  buildLinkedInHubPortScanList,
  DEFAULT_HUB_FIRST_PORT,
  DEFAULT_HUB_LAST_PORT,
  LEGACY_DEV_PORTS,
} = require("../linkedin-hub-port-scan.js");

test("port scan prefers default hub range first", () => {
  const ports = buildLinkedInHubPortScanList();
  assert.equal(ports[0], DEFAULT_HUB_FIRST_PORT);
  assert.equal(ports[15], DEFAULT_HUB_FIRST_PORT + 15);
  assert.ok(ports.includes(DEFAULT_HUB_LAST_PORT));
});

test("port scan includes legacy dev ports after hub range", () => {
  const ports = buildLinkedInHubPortScanList();
  const idxLastHub = ports.indexOf(DEFAULT_HUB_LAST_PORT);
  const idx3000 = ports.indexOf(3000);
  assert.ok(idx3000 > idxLastHub);
  for (const p of LEGACY_DEV_PORTS) {
    assert.ok(ports.includes(p));
  }
});
