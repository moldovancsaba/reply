"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  recoverDraftContextFromLearningRows,
} = require("../routes/messaging.js");

test("recoverDraftContextFromLearningRows rebuilds draft context from a close generated draft", () => {
  const recovered = recoverDraftContextFromLearningRows(
    [
      {
        event_kind: "draft_generated",
        cycle_id: "11111111-1111-4111-8111-111111111111",
        candidate_id: "22222222-2222-4222-8222-222222222222",
        thread_ref: "reply:email:alice@example.com",
        channel: "email",
        contact_handle: "alice@example.com",
        suggestion_text: "Please confirm tomorrow at 10.",
      },
    ],
    {
      channel: "email",
      contactHandle: "alice@example.com",
      finalText: "Please confirm tomorrow at 10.",
    },
  );

  assert.equal(recovered.cycleId, "11111111-1111-4111-8111-111111111111");
  assert.equal(recovered.selectedCandidateId, "22222222-2222-4222-8222-222222222222");
  assert.equal(recovered.threadRef, "reply:email:alice@example.com");
  assert.equal(recovered.recovered, true);
});

test("recoverDraftContextFromLearningRows ignores unrelated or distant generated drafts", () => {
  const recovered = recoverDraftContextFromLearningRows(
    [
      {
        event_kind: "draft_generated",
        cycle_id: "11111111-1111-4111-8111-111111111111",
        candidate_id: "22222222-2222-4222-8222-222222222222",
        thread_ref: "reply:email:alice@example.com",
        channel: "email",
        contact_handle: "alice@example.com",
        suggestion_text: "Completely different suggestion text.",
      },
    ],
    {
      channel: "email",
      contactHandle: "alice@example.com",
      finalText: "Please confirm tomorrow at 10.",
    },
  );

  assert.equal(recovered, null);
});
