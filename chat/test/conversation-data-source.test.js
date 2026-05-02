"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isCommunicationChannel,
  isConversationDataSource,
} = require("../utils/chat-utils.js");

test("conversation data source: notes and calendar stay out of inbox", () => {
  assert.equal(isConversationDataSource({ source: "apple-notes", path: "note://abc" }), false);
  assert.equal(isConversationDataSource({ source: "apple-calendar", path: "calendar://abc" }), false);
  assert.equal(isConversationDataSource({ source: "linkedin-posts", path: "doc://linkedin-posts" }), false);
});

test("conversation data source: live communication sources stay in inbox", () => {
  assert.equal(isConversationDataSource({ source: "WhatsApp", path: "whatsapp://36201234567" }), true);
  assert.equal(isConversationDataSource({ source: "Mail", path: "mailto:test@example.com" }), true);
  assert.equal(isConversationDataSource({ source: "LinkedIn", path: "linkedin://thread-1" }), true);
});

test("communication channel helper excludes document-like channels", () => {
  assert.equal(isCommunicationChannel("whatsapp"), true);
  assert.equal(isCommunicationChannel("email"), true);
  assert.equal(isCommunicationChannel("notes"), false);
  assert.equal(isCommunicationChannel("calendar"), false);
});
