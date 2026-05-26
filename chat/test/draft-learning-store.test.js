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
    assert.equal(generation.generation_id, "reply-local:test:reply-local:test:candidate-1");
    const summary = await store.listRecentLearningSummary({ contactHandle: "alice@example.com" });
    assert.equal(summary.length, 1);
    assert.equal(summary[0].outcomeDisposition, "SENT_AS_IS");
  } finally {
    delete process.env.REPLY_DATA_HOME;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

test("draft learning store summarizes imported runtime knowledge usage", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reply-learning-imported-runtime-"));
  const store = freshLearningStore(tempDir);
  try {
    await store.appendLearningEvent({
      event_kind: "draft_generated",
      source_ref: "draft-generated:imported-1",
      cycle_id: "reply-trinity:imported-1",
      candidate_id: "reply-trinity:imported-1:candidate-1",
      thread_ref: "reply:email:alice@example.com",
      channel: "email",
      contact_handle: "alice@example.com",
      runtime_mode: "trinity",
      suggestion_text: "Draft reply",
      metadata: {
        source_product: "reply",
        imported_runtime_knowledge: {
          importedRecordCount: 4,
          familyCounts: {
            "runtime-summary-candidate": 2,
            "runtime-reply-support-candidate": 2,
          },
          artifactRefs: ["runtime-pack@2026-05-25.1"],
          topSupport: [
            { documentTitle: "Client Brief" },
          ],
        },
      },
    });
    await store.appendLearningEvent({
      event_kind: "draft_revision",
      source_ref: "draft-revision:imported-1",
      cycle_id: "reply-trinity:imported-1",
      candidate_id: "reply-trinity:imported-1:candidate-1",
      thread_ref: "reply:email:alice@example.com",
      channel: "email",
      contact_handle: "alice@example.com",
      runtime_mode: "trinity",
      final_text: "Edited draft",
      metadata: {},
    });
    await store.appendLearningEvent({
      event_kind: "draft_outcome",
      source_ref: "draft-outcome:imported-1",
      cycle_id: "reply-trinity:imported-1",
      candidate_id: "reply-trinity:imported-1:candidate-1",
      thread_ref: "reply:email:alice@example.com",
      channel: "email",
      contact_handle: "alice@example.com",
      runtime_mode: "trinity",
      suggestion_text: "Draft reply",
      final_text: "Edited draft",
      reason: "EDITED_THEN_SENT",
      metadata: {},
    });

    const summary = await store.summarizeImportedRuntimeKnowledgeUsage({
      channel: "email",
      contactHandle: "alice@example.com",
    });
    assert.equal(summary.generationCount, 1);
    assert.equal(summary.generationsWithOutcomes, 1);
    assert.equal(summary.outcomeDispositionCounts.EDITED_THEN_SENT, 1);
    assert.equal(summary.revisionCountTotal, 1);
    assert.equal(summary.avgImportedRecordCount, 4);
    assert.equal(summary.familyCounts["runtime-summary-candidate"], 2);
    assert.equal(summary.familyCounts["runtime-reply-support-candidate"], 2);
    assert.deepEqual(summary.topArtifactRefs, [{ key: "runtime-pack@2026-05-25.1", count: 1 }]);
    assert.deepEqual(summary.topSupportDocuments, [{ key: "Client Brief", count: 1 }]);
  } finally {
    delete process.env.REPLY_DATA_HOME;
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
