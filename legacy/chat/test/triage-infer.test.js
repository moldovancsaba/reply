const test = require("node:test");
const assert = require("node:assert/strict");
const { inferSuggestedActions } = require("../triage-engine.js");

test("inferSuggestedActions uses explicit suggestedActions", () => {
    assert.deepEqual(inferSuggestedActions({ suggestedActions: ["Archive", "reply"] }), ["archive", "reply"]);
});

test("inferSuggestedActions falls back from action text", () => {
    assert.ok(inferSuggestedActions({ action: "Archive this newsletter" }).includes("archive"));
    assert.ok(inferSuggestedActions({ action: "Please upload the signed PDF" }).includes("upload"));
});
