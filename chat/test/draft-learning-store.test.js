"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function freshLearningStore(tempDir) {
  process.env.REPLY_DATA_HOME = tempDir;
  const appPathsPath = require.resolve("../app-paths.js");
  const storePath = require.resolve("../draft-learning-store.js");
  delete require.cache[appPathsPath];
  delete require.cache[storePath];
  return require("../draft-learning-store.js");
}

test("draft learning store persists generation and outcome events locally", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-learning-store-"));
  const store = freshLearningStore(tempDir);
  try {
    await store.appendLearningEvent({
      event_kind: "draft_generated",
      source_ref: "draft-generated:test",
      cycle_id: "reply-local:test",
      candidate_id: "reply-local:test:candidate-1",
      thread_ref: "reply:email:alice@example.com",
      channel: "email",
      contact_handle: "alice@example.com",
      runtime_mode: "local",
      suggestion_text: "Thanks Alice, sending today.",
      reason: "Writer tightened the draft.",
      metadata: { source_product: "reply" },
    });
    await store.appendLearningEvent({
      event_kind: "draft_outcome",
      source_ref: "draft-outcome:test",
      cycle_id: "reply-local:test",
      candidate_id: "reply-local:test:candidate-1",
      thread_ref: "reply:email:alice@example.com",
      channel: "email",
      contact_handle: "alice@example.com",
      runtime_mode: "local",
      suggestion_text: "Thanks Alice, sending today.",
      final_text: "Thanks Alice, sending today.",
      reason: "SENT_AS_IS",
      metadata: { send_result: "ok" },
    });

    const rows = await store.listLearningEvents(10);
    const generation = rows.find((row) => row.event_kind === "draft_generated");
    const outcome = rows.find((row) => row.event_kind === "draft_outcome");
    assert.ok(generation);
    assert.ok(outcome);
    assert.equal(generation.runtime_mode, "local");
    assert.equal(outcome.reason, "SENT_AS_IS");
  } finally {
    delete process.env.REPLY_DATA_HOME;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
