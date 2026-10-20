const test = require("node:test");
const assert = require("node:assert/strict");
const { snippetShapeForSuggestReply } = require("../routes/suggestions.js");

test("snippetShapeForSuggestReply: unannotated row omits annotation fields", () => {
  const out = snippetShapeForSuggestReply({
    source: "notes",
    path: "p1",
    text: "x".repeat(250),
    is_annotated: false
  });
  assert.equal(out.source, "notes");
  assert.equal(out.path, "p1");
  assert.ok(out.text.endsWith("…"));
  assert.equal(out.is_annotated, false);
  assert.equal("annotation_summary" in out, false);
});

test("snippetShapeForSuggestReply: annotated row parses tags and facts", () => {
  const out = snippetShapeForSuggestReply({
    source: "mail",
    path: "mailto:a@b",
    text: "hello",
    is_annotated: true,
    annotation_summary: "One line",
    annotation_tags: JSON.stringify(["work", "urgent"]),
    annotation_facts: JSON.stringify(["deadline Friday"])
  });
  assert.equal(out.is_annotated, true);
  assert.equal(out.annotation_summary, "One line");
  assert.deepEqual(out.annotation_tags, ["work", "urgent"]);
  assert.deepEqual(out.annotation_facts, ["deadline Friday"]);
});

test("snippetShapeForSuggestReply: bad JSON falls back to empty arrays", () => {
  const out = snippetShapeForSuggestReply({
    source: "x",
    path: "y",
    text: "z",
    is_annotated: true,
    annotation_tags: "not-json",
    annotation_facts: "{"
  });
  assert.deepEqual(out.annotation_tags, []);
  assert.deepEqual(out.annotation_facts, []);
});
