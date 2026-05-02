"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isCommunicationChannel,
  isConversationDataSource,
  hasUsableConversationHandle,
  contactHasUsableConversationIdentity,
} = require("../utils/chat-utils.js");
const {
  normalizeStoredDisplayName,
  presentContactLabel,
} = require("../utils/contact-labels.js");

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

test("usable conversation handle rejects placeholders and accepts real identifiers", () => {
  assert.equal(hasUsableConversationHandle("unknown", { channel: "imessage" }), false);
  assert.equal(hasUsableConversationHandle("Contact not found", { channel: "email" }), false);
  assert.equal(hasUsableConversationHandle("+36 70 123 4567", { channel: "imessage" }), true);
  assert.equal(hasUsableConversationHandle("founder@example.com", { channel: "email" }), true);
  assert.equal(hasUsableConversationHandle("120363041234567890@g.us", { channel: "whatsapp" }), true);
  assert.equal(hasUsableConversationHandle("thread-1", { channel: "linkedin" }), false);
});

test("contact identity requires a real communication coordinate", () => {
  assert.equal(contactHasUsableConversationIdentity({
    handle: "unknown",
    displayName: "Unknown",
    channels: { phone: [], email: [] },
  }), false);

  assert.equal(contactHasUsableConversationIdentity({
    handle: "unknown",
    displayName: "Alice",
    channels: { phone: ["+36 70 123 4567"], email: [] },
  }), true);

  assert.equal(contactHasUsableConversationIdentity({
    handle: "linkedin://thread-1",
    displayName: "Bob",
    linkedinUrl: "https://www.linkedin.com/in/bob-example/",
    channels: {},
  }), true);
});

test("presentation labels hide opaque machine ids and preserve real contact labels", () => {
  assert.equal(normalizeStoredDisplayName("CObm1s8GGhl0MzIzNzUzNjQ4M...", "CObm1s8GGhl0MzIzNzUzNjQ4M..."), "");
  assert.equal(normalizeStoredDisplayName("Alice Example", "alice@example.com"), "Alice Example");

  assert.equal(
    presentContactLabel({ handle: "CObm1s8GGhl0MzIzNzUzNjQ4M123456", lastChannel: "whatsapp" }, { handle: "CObm1s8GGhl0MzIzNzUzNjQ4M123456", channel: "whatsapp" }),
    "WhatsApp · CObm1s8G…3456"
  );
  assert.equal(
    presentContactLabel({ handle: "alice@example.com" }, { handle: "alice@example.com", channel: "email" }),
    "alice@example.com"
  );
});
