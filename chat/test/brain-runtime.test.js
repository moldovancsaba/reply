const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getBrainRuntimeMode,
  normalizeSuggestionResult,
} = require("../brain-runtime.js");

test("normalizeSuggestionResult unwraps string legacy results", () => {
  assert.deepEqual(normalizeSuggestionResult("Draft reply"), {
    suggestion: "Draft reply",
    explanation: "",
    contextMeta: null,
    runtimeMode: "legacy",
    rankedDraftSet: null,
    trinityDraftCandidate: null,
  });
});

test("normalizeSuggestionResult preserves structured results", () => {
  const normalized = normalizeSuggestionResult({
    suggestion: "  Draft reply  ",
    explanation: " Why this works ",
    contextMeta: { rag: [] },
    runtimeMode: "trinity-shadow",
    trinityDraftCandidate: { contractVersion: "trinity.reply.v1alpha1" },
  });

  assert.equal(normalized.suggestion, "Draft reply");
  assert.equal(normalized.explanation, "Why this works");
  assert.deepEqual(normalized.contextMeta, { rag: [] });
  assert.equal(normalized.runtimeMode, "trinity-shadow");
  assert.equal(normalized.rankedDraftSet, null);
  assert.deepEqual(normalized.trinityDraftCandidate, {
    contractVersion: "trinity.reply.v1alpha1",
  });
});

test("getBrainRuntimeMode falls back to legacy", (t) => {
  const original = process.env.REPLY_BRAIN_RUNTIME;
  t.after(() => {
    if (original == null) {
      delete process.env.REPLY_BRAIN_RUNTIME;
    } else {
      process.env.REPLY_BRAIN_RUNTIME = original;
    }
  });

  delete process.env.REPLY_BRAIN_RUNTIME;
  assert.equal(getBrainRuntimeMode(), "legacy");
});
