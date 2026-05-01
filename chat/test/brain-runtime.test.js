const test = require("node:test");
const assert = require("node:assert/strict");

const {
  allowExperimentalBrainModes,
  allowLegacyBrain,
  buildShadowComparisonSummary,
  getBrainRuntimeMode,
  normalizeSuggestionResult,
  normalizedEditDistance,
  pythonVersionSatisfies,
  releaseRuntimeEnforced,
  resolveTrinityPythonBin,
  resolveTrinityRuntimeRoot,
  tokenOverlapRatio,
  trinityShadowEnabled,
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

test("getBrainRuntimeMode defaults to trinity", (t) => {
  const originalMode = process.env.REPLY_BRAIN_RUNTIME;
  const originalLegacyFlag = process.env.REPLY_ALLOW_LEGACY_BRAIN;
  const originalRelease = process.env.REPLY_RELEASE_MODE;
  t.after(() => {
    if (originalMode == null) delete process.env.REPLY_BRAIN_RUNTIME;
    else process.env.REPLY_BRAIN_RUNTIME = originalMode;
    if (originalLegacyFlag == null) delete process.env.REPLY_ALLOW_LEGACY_BRAIN;
    else process.env.REPLY_ALLOW_LEGACY_BRAIN = originalLegacyFlag;
    if (originalRelease == null) delete process.env.REPLY_RELEASE_MODE;
    else process.env.REPLY_RELEASE_MODE = originalRelease;
  });

  delete process.env.REPLY_BRAIN_RUNTIME;
  delete process.env.REPLY_ALLOW_LEGACY_BRAIN;
  delete process.env.REPLY_RELEASE_MODE;
  assert.equal(getBrainRuntimeMode(), "trinity");
});

test("legacy mode requires explicit developer flag", (t) => {
  const originalMode = process.env.REPLY_BRAIN_RUNTIME;
  const originalLegacyFlag = process.env.REPLY_ALLOW_LEGACY_BRAIN;
  t.after(() => {
    if (originalMode == null) delete process.env.REPLY_BRAIN_RUNTIME;
    else process.env.REPLY_BRAIN_RUNTIME = originalMode;
    if (originalLegacyFlag == null) delete process.env.REPLY_ALLOW_LEGACY_BRAIN;
    else process.env.REPLY_ALLOW_LEGACY_BRAIN = originalLegacyFlag;
  });

  process.env.REPLY_BRAIN_RUNTIME = "legacy";
  delete process.env.REPLY_ALLOW_LEGACY_BRAIN;
  assert.equal(allowLegacyBrain(), false);
  assert.equal(getBrainRuntimeMode(), "trinity");
  process.env.REPLY_ALLOW_LEGACY_BRAIN = "1";
  assert.equal(allowLegacyBrain(), true);
  assert.equal(getBrainRuntimeMode(), "legacy");
});

test("shadow mode is developer-only and disabled in release mode", (t) => {
  const originalMode = process.env.REPLY_BRAIN_RUNTIME;
  const originalExperimentalFlag = process.env.REPLY_ALLOW_EXPERIMENTAL_BRAIN_MODES;
  const originalRelease = process.env.REPLY_RELEASE_MODE;
  t.after(() => {
    if (originalMode == null) delete process.env.REPLY_BRAIN_RUNTIME;
    else process.env.REPLY_BRAIN_RUNTIME = originalMode;
    if (originalExperimentalFlag == null) delete process.env.REPLY_ALLOW_EXPERIMENTAL_BRAIN_MODES;
    else process.env.REPLY_ALLOW_EXPERIMENTAL_BRAIN_MODES = originalExperimentalFlag;
    if (originalRelease == null) delete process.env.REPLY_RELEASE_MODE;
    else process.env.REPLY_RELEASE_MODE = originalRelease;
  });

  process.env.REPLY_BRAIN_RUNTIME = "trinity-shadow";
  delete process.env.REPLY_ALLOW_EXPERIMENTAL_BRAIN_MODES;
  delete process.env.REPLY_RELEASE_MODE;
  assert.equal(allowExperimentalBrainModes(), false);
  assert.equal(trinityShadowEnabled(), false);

  process.env.REPLY_ALLOW_EXPERIMENTAL_BRAIN_MODES = "1";
  assert.equal(allowExperimentalBrainModes(), true);
  assert.equal(trinityShadowEnabled(), true);

  process.env.REPLY_RELEASE_MODE = "1";
  assert.equal(releaseRuntimeEnforced(), true);
  assert.equal(allowExperimentalBrainModes(), false);
  assert.equal(getBrainRuntimeMode(), "trinity");
  assert.equal(trinityShadowEnabled(), false);
});

test("resolveTrinityRuntimeRoot prefers explicit bundled runtime env", (t) => {
  const original = process.env.TRINITY_RUNTIME_ROOT;
  t.after(() => {
    if (original == null) delete process.env.TRINITY_RUNTIME_ROOT;
    else process.env.TRINITY_RUNTIME_ROOT = original;
  });

  process.env.TRINITY_RUNTIME_ROOT = "/tmp/trinity-runtime-bundle";
  assert.equal(resolveTrinityRuntimeRoot(), "/tmp/trinity-runtime-bundle");
});

test("pythonVersionSatisfies rejects unsupported Python minors", () => {
  assert.equal(pythonVersionSatisfies("/usr/bin/python3"), false);
});

test("resolveTrinityPythonBin honors explicit compatible interpreter", (t) => {
  const original = process.env.TRINITY_PYTHON_BIN;
  t.after(() => {
    if (original == null) delete process.env.TRINITY_PYTHON_BIN;
    else process.env.TRINITY_PYTHON_BIN = original;
  });

  process.env.TRINITY_PYTHON_BIN = "/opt/homebrew/bin/python3.12";
  assert.equal(resolveTrinityPythonBin(), "/opt/homebrew/bin/python3.12");
});

test("normalizedEditDistance reports zero for exact matches", () => {
  assert.equal(normalizedEditDistance("same draft", "same draft"), 0);
});

test("tokenOverlapRatio reflects shared vocabulary", () => {
  assert.equal(tokenOverlapRatio("thanks alice send update", "thanks alice"), 0.5);
});

test("buildShadowComparisonSummary captures similarity stats", () => {
  const summary = buildShadowComparisonSummary({
    legacySuggestion: "Thanks Alice, sending today.",
    trinitySuggestion: "Thanks Alice, I can send this today.",
  });

  assert.equal(summary.sameText, false);
  assert.equal(summary.legacyLength > 0, true);
  assert.equal(summary.trinityLength > 0, true);
  assert.equal(summary.overlapRatio > 0, true);
  assert.equal(summary.editDistance > 0, true);
});
