const test = require("node:test");
const assert = require("node:assert/strict");

const {
  allowExperimentalBrainModes,
  allowLegacyBrain,
  buildDocumentRegistration,
  buildDraftOutcomeFact,
  buildDraftOutcomeEvent,
  buildMemoryEvent,
  buildRuntimeProvenance,
  buildShadowComparisonSummary,
  buildThreadSnapshot,
  clearBrainRuntimeTestHooks,
  getBrainRuntimeMode,
  classifyRuntimeFailure,
  normalizeSuggestionResult,
  normalizeReplyCompanyId,
  normalizedEditDistance,
  pythonVersionSatisfies,
  proposeTrainingPolicy,
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

test("buildDraftOutcomeEvent rejects missing required identity fields", () => {
  assert.throws(
    () => buildDraftOutcomeEvent({
      disposition: "SHOWN",
      thread_ref: "reply:email:alice@example.com",
      channel: "email",
    }),
    /missing required field: cycle_id/i,
  );
});

test("buildMemoryEvent applies runtime defaults and required normalization", () => {
  const event = buildMemoryEvent({
    event_kind: " inbound_message_recorded ",
    source_ref: " imessage:thread-1:42 ",
    thread_ref: " reply:imessage:alice ",
    channel: " iMessage ",
    contact_handle: " alice ",
    content_text: "Need the update today.",
    metadata: { display_name: "Alice" },
  });

  assert.equal(event.company_id.length > 0, true);
  assert.equal(event.event_kind, "inbound_message_recorded");
  assert.equal(event.source_ref, "imessage:thread-1:42");
  assert.equal(event.thread_ref, "reply:imessage:alice");
  assert.equal(event.channel, "imessage");
  assert.equal(event.contact_handle, "alice");
  assert.equal(event.content_text, "Need the update today.");
  assert.deepEqual(event.metadata, { display_name: "Alice" });
  assert.equal(event.contract_version, "trinity.reply.v1alpha1");
});

test("buildDocumentRegistration enforces the document contract boundary", () => {
  const registration = buildDocumentRegistration({
    document_ref: " doc-1 ",
    source: " notes ",
    path: " /tmp/doc.md ",
    title: "Operator note",
    content_text: "Key fact",
    metadata: { thread_ref: "reply:email:alice@example.com" },
  });

  assert.equal(registration.company_id.length > 0, true);
  assert.equal(registration.document_ref, "doc-1");
  assert.equal(registration.source, "notes");
  assert.equal(registration.path, "/tmp/doc.md");
  assert.equal(registration.title, "Operator note");
  assert.equal(registration.content_text, "Key fact");
  assert.deepEqual(registration.metadata, { thread_ref: "reply:email:alice@example.com" });
  assert.equal(registration.contract_version, "trinity.reply.v1alpha1");
});

test("normalizeReplyCompanyId falls back to stable reply runtime company", () => {
  const companyId = normalizeReplyCompanyId("");
  assert.match(companyId, /^[0-9a-f-]{36}$/);
});

test("buildRuntimeProvenance normalizes accepted artifact metadata", () => {
  const provenance = buildRuntimeProvenance({
    trace_ref: " /tmp/trace.json ",
    accepted_artifact_version: {
      artifact_key: "reply_ranker_policy",
      version: "v2",
      source_project: "trinity",
      accepted_at: "2026-05-07T10:00:00Z",
    },
  });

  assert.deepEqual(provenance, {
    traceRef: "/tmp/trace.json",
    acceptedArtifactVersion: {
      artifact_key: "reply_ranker_policy",
      version: "v2",
      source_project: "trinity",
      accepted_at: "2026-05-07T10:00:00Z",
    },
  });
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
    acceptedArtifactVersion: {
      artifact_key: "reply_ranker_policy",
      version: "email.v2",
      source_project: "trinity",
    },
    transport: "desktop_automation",
    humanApprovalBypass: true,
    bridgeMode: "native",
  }, { expectedChannel: "email" });

  assert.deepEqual(sanitized, {
    companyId: "company-1",
    cycleId: "cycle-1",
    threadRef: "reply:email:alice@example.com",
    channel: "email",
    acceptedArtifactVersion: {
      artifact_key: "reply_ranker_policy",
      version: "email.v2",
      source_project: "trinity",
      accepted_at: null,
    },
    traceRef: "/tmp/trace.json",
    selectedCandidateId: "candidate-1",
    selectedDraftText: "Draft reply",
    originalDraftText: "Draft reply",
    generatedAtMs: 1234,
    importedRuntimeKnowledge: null,
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

test("buildDraftOutcomeFact preserves imported runtime knowledge summary", () => {
  const event = buildDraftOutcomeFact({
    companyId: "company-1",
    cycleId: "cycle-1",
    threadRef: "reply:email:alice@example.com",
    channel: "email",
    selectedCandidateId: "candidate-1",
    selectedDraftText: "Draft reply",
    generatedAtMs: Date.now() - 10,
    runtimeDiagnostics: {
      importedRuntimeKnowledge: {
        importedRecordCount: 3,
        familyCounts: { "runtime-summary-candidate": 2 },
        importIds: ["import-1"],
        artifactRefs: ["runtime-pack@2026-05-25.1"],
        topSupport: [
          {
            recordKey: "record-1",
            family: "runtime-summary-candidate",
            documentTitle: "Client Brief",
          },
        ],
      },
    },
  }, {
    disposition: "SENT_AS_IS",
    final_text: "Draft reply",
    send_result: "ok",
    notes: "reply_send",
  }, { expectedChannel: "email" });

  assert.deepEqual(event.imported_runtime_knowledge, {
    importedRecordCount: 3,
    familyCounts: { "runtime-summary-candidate": 2 },
    importIds: ["import-1"],
    artifactRefs: ["runtime-pack@2026-05-25.1"],
    topSupport: [
      {
        recordKey: "record-1",
        family: "runtime-summary-candidate",
        documentTitle: "Client Brief",
      },
    ],
  });
});

test("proposeTrainingPolicy shells into bounded Trinity train proposals", async () => {
  const calls = [];
  setBrainRuntimeTestHooks({
    trinityRuntimeCall: async (command, payload, options) => {
      calls.push({ command, payload, options });
      return { status: "ok" };
    },
  });

  await proposeTrainingPolicy({
    learnerKind: "tone",
    cycleId: "cycle-1",
  });

  clearBrainRuntimeTestHooks();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "train-propose-policy");
  assert.equal(calls[0].payload, null);
  assert.deepEqual(calls[0].options.args, [
    "--learner-kind",
    "tone",
    "--cycle-id",
    "cycle-1",
    "--bundle-type",
    "tone-learning",
    "--transport",
    "cli",
  ]);
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
  const originalDraftRuntime = process.env.REPLY_SETTINGS_PATH;
  t.after(() => {
    if (originalMode == null) delete process.env.REPLY_BRAIN_RUNTIME;
    else process.env.REPLY_BRAIN_RUNTIME = originalMode;
    if (originalLegacyFlag == null) delete process.env.REPLY_ALLOW_LEGACY_BRAIN;
    else process.env.REPLY_ALLOW_LEGACY_BRAIN = originalLegacyFlag;
    if (originalRelease == null) delete process.env.REPLY_RELEASE_MODE;
    else process.env.REPLY_RELEASE_MODE = originalRelease;
    if (originalDraftRuntime == null) delete process.env.REPLY_SETTINGS_PATH;
    else process.env.REPLY_SETTINGS_PATH = originalDraftRuntime;
  });

  delete process.env.REPLY_BRAIN_RUNTIME;
  delete process.env.REPLY_ALLOW_LEGACY_BRAIN;
  delete process.env.REPLY_RELEASE_MODE;
  process.env.REPLY_SETTINGS_PATH = "/tmp/reply-brain-runtime-test-defaults.json";
  assert.equal(getBrainRuntimeMode(), "trinity");
});

test("getBrainRuntimeMode honors explicit local runtime", (t) => {
  const originalMode = process.env.REPLY_BRAIN_RUNTIME;
  t.after(() => {
    if (originalMode == null) delete process.env.REPLY_BRAIN_RUNTIME;
    else process.env.REPLY_BRAIN_RUNTIME = originalMode;
  });

  process.env.REPLY_BRAIN_RUNTIME = "local";
  assert.equal(getBrainRuntimeMode(), "local");
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
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trinity-runtime-bundle-"));
  fs.mkdirSync(path.join(runtimeRoot, "core", "trinity_core"), { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, "core", "trinity_core", "cli.py"), "# test\n", "utf8");
  t.after(() => {
    if (original == null) delete process.env.TRINITY_RUNTIME_ROOT;
    else process.env.TRINITY_RUNTIME_ROOT = original;
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  });

  process.env.TRINITY_RUNTIME_ROOT = runtimeRoot;
  assert.equal(resolveTrinityRuntimeRoot(), runtimeRoot);
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
      assert.equal(command, "suggest");
      return {
        cycle_id: "cycle-shadow-1",
        trace_ref: "/tmp/trinity-shadow-trace.json",
        accepted_artifact_version: {
          artifact_key: "reply_ranker_policy",
          version: "reply_ranker_policy.v0",
          source_project: "trinity",
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

test("generateReply uses reply-local router in local mode", async (t) => {
  const originalMode = process.env.REPLY_BRAIN_RUNTIME;
  t.after(() => {
    clearBrainRuntimeTestHooks();
    if (originalMode == null) delete process.env.REPLY_BRAIN_RUNTIME;
    else process.env.REPLY_BRAIN_RUNTIME = originalMode;
  });

  process.env.REPLY_BRAIN_RUNTIME = "local";
  setBrainRuntimeTestHooks({
    localGenerateReply: async (message, contextSnippets, recipient, goldenExamples) => ({
      suggestion: `Local draft for ${recipient}`,
      explanation: `handled ${message} with ${contextSnippets.length} snippets and ${goldenExamples.length} golden`,
      contextMeta: { runtime: "local", selectedStage: "writer" },
      runtimeMode: "local",
      rankedDraftSet: null,
      trinityDraftCandidate: null,
    }),
  });

  const result = await require("../brain-runtime.js").generateReply(
    "Need the update today.",
    [{ text: "Snippet" }],
    "alice@example.com",
    [{ text: "Golden" }],
  );

  assert.equal(result.suggestion, "Local draft for alice@example.com");
  assert.equal(result.runtimeMode, "local");
  assert.equal(result.contextMeta.runtime, "local");
  assert.equal(result.contextMeta.selectedStage, "writer");
  assert.equal(String(result.rankedDraftSet?.cycle_id || "").startsWith("reply-local:"), true);
  assert.equal(result.rankedDraftSet?.drafts?.[0]?.draft_text, "Local draft for alice@example.com");
});

test("generateReply falls back to local drafting when Trinity suggest fails", async (t) => {
  const originalMode = process.env.REPLY_BRAIN_RUNTIME;
  t.after(() => {
    clearBrainRuntimeTestHooks();
    if (originalMode == null) delete process.env.REPLY_BRAIN_RUNTIME;
    else process.env.REPLY_BRAIN_RUNTIME = originalMode;
  });

  process.env.REPLY_BRAIN_RUNTIME = "trinity";
  setBrainRuntimeTestHooks({
    trinityRuntimeCall: async () => {
      throw new Error("Trinity command timed out after 45000ms");
    },
    localGenerateReply: async (message, _contextSnippets, recipient) => ({
      suggestion: `Local fallback for ${recipient}`,
      explanation: `fallback handled ${message}`,
      contextMeta: { runtime: "local", selectedStage: "writer" },
      runtimeMode: "local",
      rankedDraftSet: null,
      trinityDraftCandidate: null,
    }),
  });

  const result = await require("../brain-runtime.js").generateReply(
    "Need the update today.",
    [],
    "alice@example.com",
    [],
  );

  assert.equal(result.suggestion, "Local fallback for alice@example.com");
  assert.equal(result.runtimeMode, "trinity-fallback-local");
  assert.equal(result.contextMeta.runtime, "trinity-fallback-local");
  assert.equal(result.contextMeta.fallbackFrom, "trinity");
  assert.match(result.contextMeta.trinityError, /timed out/i);
  assert.equal(String(result.rankedDraftSet?.cycle_id || "").startsWith("reply-local:"), true);
});

test("generateReply preserves imported runtime knowledge diagnostics from Trinity", async (t) => {
  const originalMode = process.env.REPLY_BRAIN_RUNTIME;
  t.after(() => {
    clearBrainRuntimeTestHooks();
    if (originalMode == null) delete process.env.REPLY_BRAIN_RUNTIME;
    else process.env.REPLY_BRAIN_RUNTIME = originalMode;
  });

  process.env.REPLY_BRAIN_RUNTIME = "trinity";
  setBrainRuntimeTestHooks({
    trinityRuntimeCall: async (command) => {
      assert.equal(command, "suggest");
      return {
        cycle_id: "cycle-imported-1",
        trace_ref: "/tmp/trinity-imported-trace.json",
        accepted_artifact_version: {
          artifact_key: "reply_ranker_policy",
          version: "reply_ranker_policy.v0",
          source_project: "trinity",
        },
        drafts: [
          {
            candidate_id: "candidate-1",
            draft_text: "Imported knowledge draft",
            rationale: "Top ranked draft",
          },
        ],
        runtime_diagnostics: {
          provider: "ollama",
          pipeline: { total_ms: 777 },
          imported_runtime_knowledge: {
            imported_record_count: 4,
            family_counts: {
              "runtime-summary-candidate": 2,
              "runtime-reply-support-candidate": 1,
              "runtime-memory-candidate": 1,
            },
            import_ids: ["runtime-candidate-pack-2026-05-24.1"],
            artifact_refs: ["runtime-candidate-pack@2026-05-24.1"],
            top_support: [
              {
                record_key: "chunk:train-import:1",
                family: "runtime-reply-support-candidate",
                document_title: "Launch Checklist",
                confidence: 0.84,
                freshness_bucket: "recent",
              },
            ],
          },
        },
      };
    },
  });

  const result = await require("../brain-runtime.js").generateReply(
    "Need the update today.",
    [],
    "alice@example.com",
    [],
  );

  assert.equal(result.suggestion, "Imported knowledge draft");
  assert.equal(result.contextMeta.runtimeDiagnostics.importedRuntimeKnowledge.importedRecordCount, 4);
  assert.equal(
    result.contextMeta.runtimeDiagnostics.importedRuntimeKnowledge.familyCounts["runtime-summary-candidate"],
    2,
  );
  assert.equal(
    result.contextMeta.runtimeDiagnostics.importedRuntimeKnowledge.topSupport[0].documentTitle,
    "Launch Checklist",
  );
});

test("generateReply recovers a prepared Trinity draft before falling back local", async (t) => {
  const originalMode = process.env.REPLY_BRAIN_RUNTIME;
  t.after(() => {
    clearBrainRuntimeTestHooks();
    if (originalMode == null) delete process.env.REPLY_BRAIN_RUNTIME;
    else process.env.REPLY_BRAIN_RUNTIME = originalMode;
  });

  process.env.REPLY_BRAIN_RUNTIME = "trinity";
  setBrainRuntimeTestHooks({
    trinityRuntimeCall: async (command) => {
      if (command === "suggest") {
        throw new Error("Trinity command timed out after 45000ms");
      }
      if (command === "get-prepared-draft") {
        return {
          prepared_draft_set: {
            ranked_draft_set: {
              cycle_id: "cycle-prepared-1",
              drafts: [
                {
                  candidate_id: "candidate-1",
                  draft_text: "Prepared Trinity draft",
                  rationale: "Recovered from prepared context",
                },
              ],
              runtime_diagnostics: {
                provider: "ollama",
                pipeline: { total_ms: 2222 },
                stage_timings: { pipeline_ms: 1200, post_process_ms: 40 },
                imported_runtime_knowledge: {
                  imported_record_count: 2,
                  family_counts: {
                    "runtime-summary-candidate": 1,
                    "runtime-reply-support-candidate": 1,
                  },
                  import_ids: ["runtime-candidate-pack-2026-05-24.1"],
                  artifact_refs: ["runtime-candidate-pack@2026-05-24.1"],
                  top_support: [
                    {
                      record_key: "summary:train-import:1",
                      family: "runtime-summary-candidate",
                      document_title: "Meeting Notes",
                      freshness_bucket: "fresh",
                    },
                  ],
                },
              },
            },
          },
        };
      }
      throw new Error(`unexpected command: ${command}`);
    },
    localGenerateReply: async () => {
      throw new Error("local fallback should not run when prepared draft exists");
    },
  });

  const result = await require("../brain-runtime.js").generateReply(
    "Need the update today.",
    [],
    "alice@example.com",
    [],
  );

  assert.equal(result.suggestion, "Prepared Trinity draft");
  assert.equal(result.explanation, "Recovered from prepared context");
  assert.equal(result.runtimeMode, "trinity-prepared-fallback");
  assert.equal(result.contextMeta.runtime, "trinity-prepared-fallback");
  assert.equal(result.contextMeta.recoveredFromPreparedDraft, true);
  assert.equal(result.contextMeta.fallbackFrom, "trinity");
  assert.equal(result.contextMeta.runtimeDiagnostics.provider, "ollama");
  assert.equal(result.contextMeta.runtimeDiagnostics.totalMs, 2222);
  assert.equal(result.contextMeta.runtimeDiagnostics.importedRuntimeKnowledge.importedRecordCount, 2);
  assert.equal(result.rankedDraftSet?.cycle_id, "cycle-prepared-1");
});
