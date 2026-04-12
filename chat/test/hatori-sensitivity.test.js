const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeMetadataSensitivity, defaultSensitivityMeta } = require("../hatori-client.js");

test("mergeMetadataSensitivity fills defaults and preserves overrides", () => {
  const m = mergeMetadataSensitivity({ source: "x", sensitivity: { safe_to_index: false } }, "email");
  assert.equal(m.source, "x");
  assert.equal(m.sensitivity.safe_to_index, false);
  assert.equal(m.sensitivity.payload_class, "raw");
  assert.equal(m.sensitivity.channel_scoped_ids, true);
});

test("defaultSensitivityMeta returns stable shape", () => {
  const d = defaultSensitivityMeta("imessage", { pii_classes: ["phone"] });
  assert.deepEqual(d.pii_classes, ["phone"]);
});
