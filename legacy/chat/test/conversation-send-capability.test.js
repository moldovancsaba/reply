"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { checkConversationCapabilityGate } = require("../routes/messaging.js");

test("conversation capability gate rejects sends without a canonical conversation summary", () => {
  const gate = checkConversationCapabilityGate(null, {
    channel: "whatsapp",
    conversationId: "conversation:missing",
  });

  assert.equal(gate.allowed, false);
  assert.equal(gate.code, "conversation_capability_missing");
});

test("conversation capability gate rejects stale conversation ids", () => {
  const gate = checkConversationCapabilityGate({
    conversationId: "conversation:live",
    conversationIds: ["conversation:live", "conversation:alias"],
    allowedChannels: ["whatsapp"],
  }, {
    channel: "whatsapp",
    conversationId: "conversation:stale",
  });

  assert.equal(gate.allowed, false);
  assert.equal(gate.code, "conversation_context_stale");
});

test("conversation capability gate rejects channels outside allowed conversation channels", () => {
  const gate = checkConversationCapabilityGate({
    conversationId: "conversation:live",
    conversationIds: ["conversation:live"],
    allowedChannels: ["whatsapp"],
  }, {
    channel: "imessage",
    conversationId: "conversation:live",
  });

  assert.equal(gate.allowed, false);
  assert.equal(gate.code, "conversation_channel_not_allowed");
});

test("conversation capability gate allows sends on explicitly allowed conversation channels", () => {
  const gate = checkConversationCapabilityGate({
    conversationId: "conversation:live",
    conversationIds: ["conversation:live"],
    allowedChannels: ["whatsapp", "email"],
  }, {
    channel: "whatsapp",
    conversationId: "conversation:live",
  });

  assert.equal(gate.allowed, true);
  assert.deepEqual(gate.allowedChannels, ["email", "whatsapp"]);
});
