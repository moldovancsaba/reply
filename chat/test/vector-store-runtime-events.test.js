"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildRuntimeDocumentRegistrations } = require("../vector-store.js");

test("non-conversation documents build normalized Trinity document registrations", () => {
  const registrations = buildRuntimeDocumentRegistrations([
    {
      id: "note-1",
      text: "Operator note about Alice",
      source: "Apple Notes",
      path: "notes://alice/1",
      title: "Alice note",
      timestamp: "2026-05-09T10:00:00.000Z",
    },
    {
      id: "mail-1",
      text: "Inbound mail body",
      source: "Mail",
      path: "mailto:alice@example.com",
      timestamp: "2026-05-09T10:01:00.000Z",
    },
  ]);

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].document_ref, "note-1");
  assert.equal(registrations[0].source, "Apple Notes");
  assert.equal(registrations[0].path, "notes://alice/1");
  assert.equal(registrations[0].title, "Alice note");
  assert.equal(registrations[0].content_text, "Operator note about Alice");
  assert.equal(registrations[0].metadata.source_product, "reply");
});
