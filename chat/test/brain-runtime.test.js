const test = require("node:test");
const assert = require("node:assert/strict");

const {
  allowExperimentalBrainModes,
  allowLegacyBrain,
  buildDraftOutcomeFact,
  buildDraftOutcomeEvent,
  buildShadowComparisonSummary,
  buildThreadSnapshot,
  clearBrainRuntimeTestHooks,
  getBrainRuntimeMode,
  classifyRuntimeFailure,
  normalizeSuggestionResult,
  normalizedEditDistance,
  pythonVersionSatisfies,
  releaseRuntimeEnforced,
  resolveTrinityPythonBin,
  resolveTrinityRuntimeRoot,
  sanitizeDraftContext,
  setBrainRuntimeTestHooks,
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
    rankedDraftSet: { accepted_artifact_version: { version: "reply_ranker_policy.v0" } },
    trinityDraftCandidate: { contractVersion: "trinity.reply.v1alpha1" },
  });

  assert.equal(normalized.suggestion, "Draft reply");
  assert.equal(normalized.explanation, "Why this works");
  assert.deepEqual(normalized.contextMeta, { rag: [] });
  assert.equal(normalized.runtimeMode, "trinity-shadow");
  assert.deepEqual(normalized.rankedDraftSet, {
    accepted_artifact_version: { version: "reply_ranker_policy.v0" },
  });
  assert.deepEqual(normalized.trinityDraftCandidate, {
    contractVersion: "trinity.reply.v1alpha1",
  });
});

test("buildDraftOutcomeEvent applies deterministic contract defaults", () => {
  const event = buildDraftOutcomeEvent({
    cycle_id: " cycle-1 ",
    thread_ref: " reply:whatsapp:alice ",
    channel: " WhatsApp ",
    disposition: "SHOWN",
    candidate_id: " candidate-1 ",
    edit_distance: "0.25",
    latency_ms: "12",
  });

  assert.equal(event.company_id.length > 0, true);
  assert.equal(event.cycle_id, "cycle-1");
  assert.equal(event.thread_ref, "reply:whatsapp:alice");
  assert.equal(event.channel, "whatsapp");
  assert.equal(event.candidate_id, "candidate-1");
  assert.equal(event.edit_distance, 0.25);
  assert.equal(event.latency_ms, 12);
  assert.equal(event.contract_version, "trinity.reply.v1alpha1");
});

test("sanitizeDraftContext keeps only bounded runtime fact fields", () => {
  const sanitized = sanitizeDraftContext({
    companyId: "company-1",
    cycleId: "cycle-1",
    threadRef: "reply:email:alice@example.com",
    channel: "Email",
    selectedCandidateId: "candidate-1",
    selectedDraftText: "Draft reply",
    originalDraftText: "Draft reply",
    generatedAtMs: 1234,
    traceRef: "/tmp/trace.json",
    acceptedArtifactVersion: { version: "email.v2" },
    transport: "desktop_automation",
    humanApprovalBypass: true,
    bridgeMode: "native",
  }, { expectedChannel: "email" });

  assert.deepEqual(sanitized, {
    companyId: "company-1",
    cycleId: "cycle-1",
    threadRef: "reply:email:alice@example.com",
    channel: "email",
    acceptedArtifactVersion: { version: "email.v2" },
    traceRef: "/tmp/trace.json",
    selectedCandidateId: "candidate-1",
    selectedDraftText: "Draft reply",
    originalDraftText: "Draft reply",
    generatedAtMs: 1234,
  });
  assert.equal("transport" in sanitized, false);
  assert.equal("humanApprovalBypass" in sanitized, false);
  assert.equal("bridgeMode" in sanitized, false);
});

test("buildDraftOutcomeFact emits bounded operator outcome facts", () => {
  const event = buildDraftOutcomeFact({
    companyId: "company-1",
    cycleId: "cycle-1",
    threadRef: "reply:email:alice@example.com",
    channel: "email",
    selectedCandidateId: "candidate-1",
    selectedDraftText: "Draft reply",
    generatedAtMs: Date.now() - 10,
    transport: "should_not_leak",
  }, {
    disposition: "SENT_AS_IS",
    final_text: "Draft reply",
    send_result: "ok",
    notes: "reply_send",
  }, { expectedChannel: "email" });

  assert.equal(event.company_id, "company-1");
  assert.equal(event.cycle_id, "cycle-1");
  assert.equal(event.thread_ref, "reply:email:alice@example.com");
  assert.equal(event.channel, "email");
  assert.equal(event.candidate_id, "candidate-1");
  assert.equal(event.disposition, "SENT_AS_IS");
  assert.equal(event.original_draft_text, "Draft reply");
  assert.equal(event.final_text, "Draft reply");
  assert.equal(event.send_result, "ok");
  assert.equal(event.notes, "reply_send");
  assert.equal("transport" in event, false);
});

test("buildThreadSnapshot includes canonical contract version", async () => {
  const snapshot = await buildThreadSnapshot("Need the update today.");

  assert.equal(snapshot.latest_inbound_text, "Need the update today.");
  assert.equal(snapshot.contract_version, "trinity.reply.v1alpha1");
  assert.equal(snapshot.metadata.source_product, "reply");
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
  assert.equal(allowLegacyBrain(), false);
  assert.equal(getBrainRuntimeMode(), "trinity");
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

test("classifyRuntimeFailure redacts docker and sandbox substrate details", () => {
  const failure = classifyRuntimeFailure(new Error(
    "Agent failed before reply: Failed to inspect sandbox image: Cannot connect to the Docker daemon at unix:///Users/test/.colima/default/docker.sock. Is the docker daemon running?. Logs: openclaw logs --follow",
  ));

  assert.deepEqual(failure, {
    status: 503,
    code: "local_sandbox_unavailable",
    error: "Local agent runtime is unavailable.",
    hint: "Start Docker or Colima and the local sandbox runtime, then retry.",
    retriable: true,
  });
});

test("classifyRuntimeFailure maps trinity runtime failures to safe product errors", () => {
  const failure = classifyRuntimeFailure(new Error("{trinity} suggest failed: Trinity runtime exited with code 1"));

  assert.deepEqual(failure, {
    status: 503,
    code: "trinity_runtime_unavailable",
    error: "Reply drafting runtime is unavailable.",
    hint: "Retry shortly. If the problem persists, check the local Trinity runtime health.",
    retriable: true,
  });
});

test("generateReply dual-runs Trinity in shadow mode while keeping legacy active", async (t) => {
  const originalMode = process.env.REPLY_BRAIN_RUNTIME;
  const originalExperimentalFlag = process.env.REPLY_ALLOW_EXPERIMENTAL_BRAIN_MODES;
  const shadowWrites = [];
  t.after(() => {
    clearBrainRuntimeTestHooks();
    if (originalMode == null) delete process.env.REPLY_BRAIN_RUNTIME;
    else process.env.REPLY_BRAIN_RUNTIME = originalMode;
    if (originalExperimentalFlag == null) delete process.env.REPLY_ALLOW_EXPERIMENTAL_BRAIN_MODES;
    else process.env.REPLY_ALLOW_EXPERIMENTAL_BRAIN_MODES = originalExperimentalFlag;
  });

  process.env.REPLY_BRAIN_RUNTIME = "trinity-shadow";
  process.env.REPLY_ALLOW_EXPERIMENTAL_BRAIN_MODES = "1";
  setBrainRuntimeTestHooks({
    legacyGenerateReply: async () => "Legacy draft reply",
    trinityRuntimeCall: async (command) => {
      assert.equal(command, "reply-suggest");
      return {
        cycle_id: "cycle-shadow-1",
        trace_ref: "/tmp/trinity-shadow-trace.json",
        accepted_artifact_version: {
          artifact_key: "reply_ranker_policy",
          version: "reply_ranker_policy.v0",
        },
        drafts: [
          {
            candidate_id: "candidate-1",
            draft_text: "Trinity draft reply",
            rationale: "Top ranked draft",
          },
        ],
      };
    },
    persistShadowComparison: (payload) => shadowWrites.push(payload),
  });

  const result = await require("../brain-runtime.js").generateReply(
    "Need the update today.",
    [],
    "alice@example.com",
    [],
  );

  assert.equal(result.suggestion, "Legacy draft reply");
  assert.equal(result.runtimeMode, "trinity-shadow");
  assert.equal(result.contextMeta.runtime, "trinity-shadow");
  assert.equal(result.contextMeta.trinityCycleId, "cycle-shadow-1");
  assert.equal(result.contextMeta.trinityTraceRef, "/tmp/trinity-shadow-trace.json");
  assert.equal(result.contextMeta.acceptedArtifactVersion.version, "reply_ranker_policy.v0");
  assert.equal(result.trinityDraftCandidate.contractVersion, "trinity.reply.v1alpha1");
  assert.equal(shadowWrites.length, 1);
  assert.equal(shadowWrites[0].legacySuggestion, "Legacy draft reply");
  assert.equal(shadowWrites[0].trinitySuggestion, "Trinity draft reply");
});
