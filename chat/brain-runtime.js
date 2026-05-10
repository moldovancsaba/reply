const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const { getDraftRuntimeMode } = require("./ai-runtime-config.js");
const contactStore = require("./contact-store.js");
const messageStore = require("./message-store.js");
const preparedContextStore = require("./prepared-context-store.js");
const trinityEventOutbox = require("./trinity-event-outbox.js");
const { ensureDataHome, dataPath } = require("./app-paths.js");
const { pathPrefixesForHandle, inferChannelFromHandle, extractDateFromText, stripMessagePrefix } = require("./utils/chat-utils.js");

const REPLY_TRINITY_CONTRACT_VERSION = "trinity.reply.v1alpha1";
const REPLY_TRINITY_ADAPTER = "reply";
const TRUE_VALUES = new Set(["1", "true", "yes"]);
const REPLY_TRAIN_BUNDLE_TYPE_BY_LEARNER = {
  tone: "tone-learning",
  brevity: "brevity-learning",
  "channel-formatting": "channel-formatting-learning",
};
const LEGACY_TRINITY_COMMAND_ALIASES = {
  suggest: "reply-suggest",
  "record-outcome": "reply-record-outcome",
  "export-trace": "reply-export-trace",
  "export-training-bundle": "reply-export-training-bundle",
  "run-shadow-fixtures": "reply-run-shadow-fixtures",
  "policy-accept": "reply-policy-accept",
  "policy-promote": "reply-policy-promote",
  "policy-rollback": "reply-policy-rollback",
  "policy-status": "reply-policy-status",
  "show-config": "reply-show-config",
  "runtime-status": "reply-runtime-status",
  "write-config": "reply-write-config",
};
const brainRuntimeTestHooks = {
  legacyGenerateReply: null,
  localGenerateReply: null,
  trinityRuntimeCall: null,
  persistShadowComparison: null,
};

function envFlagEnabled(name) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  return TRUE_VALUES.has(value);
}

function releaseRuntimeEnforced() {
  return envFlagEnabled("REPLY_RELEASE_MODE") || envFlagEnabled("REPLY_BUNDLED_APP");
}

function allowLegacyBrain() {
  return false;
}

function allowExperimentalBrainModes() {
  return !releaseRuntimeEnforced() && envFlagEnabled("REPLY_ALLOW_EXPERIMENTAL_BRAIN_MODES");
}

function loadLegacyReplyEngine() {
  if (typeof brainRuntimeTestHooks.legacyGenerateReply === "function") {
    return { generateReply: brainRuntimeTestHooks.legacyGenerateReply };
  }
  return require("./reply-engine.js");
}

function loadLocalBrainRouter() {
  if (typeof brainRuntimeTestHooks.localGenerateReply === "function") {
    return { generateReplyWithLocalBrain: brainRuntimeTestHooks.localGenerateReply };
  }
  return require("./local-brain-router.js");
}

function getBrainRuntimeMode() {
  const raw = String(process.env.REPLY_BRAIN_RUNTIME || "").trim().toLowerCase();
  if (raw === "local") return "local";
  if (raw === "trinity-shadow") {
    return allowExperimentalBrainModes() ? "trinity-shadow" : "trinity";
  }
  if (raw === "trinity") return "trinity";
  if (getDraftRuntimeMode() === "ollama") return "local";
  return "trinity";
}

function trinityDraftsEnabled() {
  if (envFlagEnabled("USE_TRINITY_DRAFTS")) return true;
  return getBrainRuntimeMode() === "trinity";
}

function trinityShadowEnabled() {
  return getBrainRuntimeMode() === "trinity-shadow";
}

function normalizeSuggestionResult(result) {
  if (typeof result === "string") {
    return {
      suggestion: result,
      explanation: "",
      contextMeta: null,
      runtimeMode: "legacy",
      rankedDraftSet: null,
      trinityDraftCandidate: null,
    };
  }

  return {
    suggestion: String(result?.suggestion || "").trim(),
    explanation: String(result?.explanation || "").trim(),
    contextMeta: result?.contextMeta || null,
    runtimeMode: result?.runtimeMode || null,
    rankedDraftSet: result?.rankedDraftSet || null,
    trinityDraftCandidate: result?.trinityDraftCandidate || null,
  };
}

function normalizeReplyCompanyId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || resolveReplyCompanyId();
}

function normalizeAcceptedArtifactVersion(raw) {
  if (!raw || typeof raw !== "object") return null;
  const artifactKey = String(raw.artifact_key || raw.artifactKey || "").trim();
  const version = String(raw.version || "").trim();
  const sourceProject = String(raw.source_project || raw.sourceProject || "").trim();
  const acceptedAt = String(raw.accepted_at || raw.acceptedAt || "").trim();
  if (!artifactKey || !version || !sourceProject) return null;
  return {
    artifact_key: artifactKey,
    version,
    source_project: sourceProject,
    accepted_at: acceptedAt || null,
  };
}

function buildRuntimeProvenance(payload = {}) {
  return {
    traceRef: String(payload.trace_ref || payload.traceRef || "").trim() || null,
    acceptedArtifactVersion: normalizeAcceptedArtifactVersion(
      payload.accepted_artifact_version || payload.acceptedArtifactVersion || null,
    ),
  };
}

function buildDraftOutcomeEvent(outcome = {}) {
  const payload = outcome && typeof outcome === "object" ? outcome : {};
  const normalizedChannel = String(payload.channel || "").trim().toLowerCase();
  const normalizedCandidateId = String(payload.candidate_id || "").trim() || null;
  const normalizedNotes = String(payload.notes || "").trim() || null;
  const normalizedSendResult = String(payload.send_result || "").trim() || null;
  const originalDraftText = payload.original_draft_text == null
    ? null
    : String(payload.original_draft_text);
  const finalText = payload.final_text == null ? null : String(payload.final_text);
  const editDistance = payload.edit_distance == null ? null : Number(payload.edit_distance);
  const latencyMs = payload.latency_ms == null ? null : Number(payload.latency_ms);
  const event = {
    company_id: normalizeReplyCompanyId(payload.company_id),
    cycle_id: String(payload.cycle_id || "").trim(),
    thread_ref: String(payload.thread_ref || "").trim(),
    channel: normalizedChannel,
    disposition: String(payload.disposition || "").trim(),
    occurred_at: String(payload.occurred_at || new Date().toISOString()).trim(),
    candidate_id: normalizedCandidateId,
    original_draft_text: originalDraftText,
    final_text: finalText,
    edit_distance: Number.isFinite(editDistance) ? editDistance : null,
    latency_ms: Number.isFinite(latencyMs) ? latencyMs : null,
    send_result: normalizedSendResult,
    notes: normalizedNotes,
    contract_version: String(payload.contract_version || REPLY_TRINITY_CONTRACT_VERSION).trim(),
  };
  const requiredFields = ["company_id", "cycle_id", "thread_ref", "channel", "disposition", "occurred_at"];
  for (const field of requiredFields) {
    if (!String(event[field] || "").trim()) {
      throw new Error(`DraftOutcomeEvent missing required field: ${field}`);
    }
  }

  return event;
}

function buildMemoryEvent(event = {}) {
  const payload = event && typeof event === "object" ? event : {};
  const built = {
    company_id: normalizeReplyCompanyId(payload.company_id),
    event_kind: String(payload.event_kind || "").trim(),
    source_ref: String(payload.source_ref || "").trim(),
    occurred_at: String(payload.occurred_at || new Date().toISOString()).trim(),
    thread_ref: String(payload.thread_ref || "").trim() || null,
    channel: String(payload.channel || "").trim().toLowerCase() || null,
    contact_handle: String(payload.contact_handle || "").trim() || null,
    content_text: payload.content_text == null ? null : String(payload.content_text),
    metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
    contract_version: String(payload.contract_version || REPLY_TRINITY_CONTRACT_VERSION).trim(),
  };
  for (const field of ["company_id", "event_kind", "source_ref", "occurred_at"]) {
    if (!String(built[field] || "").trim()) {
      throw new Error(`MemoryEvent missing required field: ${field}`);
    }
  }
  return built;
}

function buildDocumentRegistration(document = {}) {
  const payload = document && typeof document === "object" ? document : {};
  const built = {
    company_id: normalizeReplyCompanyId(payload.company_id),
    document_ref: String(payload.document_ref || "").trim(),
    source: String(payload.source || "").trim(),
    path: String(payload.path || "").trim(),
    title: payload.title == null ? null : String(payload.title),
    content_text: payload.content_text == null ? "" : String(payload.content_text),
    occurred_at: String(payload.occurred_at || new Date().toISOString()).trim(),
    metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
    contract_version: String(payload.contract_version || REPLY_TRINITY_CONTRACT_VERSION).trim(),
  };
  for (const field of ["company_id", "document_ref", "source", "path"]) {
    if (!String(built[field] || "").trim()) {
      throw new Error(`DocumentRegistration missing required field: ${field}`);
    }
  }
  return built;
}

function classifyRuntimeFailure(error, options = {}) {
  const fallbackMessage = String(options.fallbackMessage || "Reply runtime is unavailable.").trim();
  const rawMessage = String(error?.message || error || "").trim();
  const normalized = rawMessage.toLowerCase();

  if (
    normalized.includes("cannot connect to the docker daemon")
    || normalized.includes("docker.sock")
    || normalized.includes("failed to inspect sandbox image")
    || normalized.includes("sandbox image")
    || normalized.includes("colima")
  ) {
    return {
      status: 503,
      code: "local_sandbox_unavailable",
      error: "Local agent runtime is unavailable.",
      hint: "Start Docker or Colima and the local sandbox runtime, then retry.",
      retriable: true,
    };
  }

  if (
    normalized.includes("openclaw")
    || normalized.includes("gateway health")
    || normalized.includes("gateway offline")
  ) {
    return {
      status: 503,
      code: "openclaw_unavailable",
      error: "OpenClaw runtime is unavailable.",
      hint: "Start OpenClaw or its gateway, then retry.",
      retriable: true,
    };
  }

  if (
    normalized.includes("ollama")
    || normalized.includes("model route")
    || normalized.includes("runtime status check failed")
  ) {
    return {
      status: 503,
      code: "local_model_runtime_unavailable",
      error: "Local model runtime is unavailable.",
      hint: "Start Ollama and confirm the configured models are available, then retry.",
      retriable: true,
    };
  }

  if (
    normalized.includes("{trinity} suggest failed")
    || normalized.includes("trinity runtime exited")
    || normalized.includes("failed to parse trinity runtime response")
  ) {
    return {
      status: 503,
      code: "trinity_runtime_unavailable",
      error: "Reply drafting runtime is unavailable.",
      hint: "Retry shortly. If the problem persists, check the local Trinity runtime health.",
      retriable: true,
    };
  }

  return {
    status: 500,
    code: "reply_runtime_failure",
    error: fallbackMessage,
    hint: null,
    retriable: false,
  };
}

function sanitizeDraftContext(draftContext = {}, options = {}) {
  const payload = draftContext && typeof draftContext === "object" ? draftContext : {};
  const expectedChannel = String(options.expectedChannel || payload.channel || "").trim().toLowerCase();
  const normalizedCompanyId = normalizeReplyCompanyId(payload.companyId || payload.company_id);
  const normalizedCycleId = String(payload.cycleId || payload.cycle_id || "").trim();
  const normalizedThreadRef = String(payload.threadRef || payload.thread_ref || "").trim();
  const normalizedCandidateId = String(
    payload.selectedCandidateId || payload.selected_candidate_id || "",
  ).trim();
  const generatedAtMs = Number(payload.generatedAtMs ?? payload.generated_at_ms);
  const provenance = buildRuntimeProvenance(payload);

  return {
    companyId: normalizedCompanyId,
    cycleId: normalizedCycleId || "",
    threadRef: normalizedThreadRef || "",
    channel: expectedChannel || "",
    acceptedArtifactVersion: provenance.acceptedArtifactVersion,
    traceRef: provenance.traceRef,
    selectedCandidateId: normalizedCandidateId || null,
    selectedDraftText: String(payload.selectedDraftText || payload.selected_draft_text || "").trim(),
    originalDraftText: String(payload.originalDraftText || payload.original_draft_text || "").trim(),
    generatedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : Date.now(),
  };
}

function buildDraftOutcomeFact(draftContext = {}, outcome = {}, options = {}) {
  const sanitized = sanitizeDraftContext(draftContext, options);
  if (!sanitized.cycleId || !sanitized.threadRef || !sanitized.channel) {
    return null;
  }
  const originalDraftText = outcome.original_draft_text != null
    ? String(outcome.original_draft_text)
    : sanitized.selectedDraftText || sanitized.originalDraftText || null;
  const latencyMs = outcome.latency_ms != null
    ? outcome.latency_ms
    : Math.max(0, Date.now() - Number(sanitized.generatedAtMs || Date.now()));
  return buildDraftOutcomeEvent({
    company_id: normalizeReplyCompanyId(outcome.company_id || sanitized.companyId),
    cycle_id: sanitized.cycleId,
    thread_ref: sanitized.threadRef,
    channel: sanitized.channel,
    candidate_id: outcome.candidate_id || sanitized.selectedCandidateId || null,
    disposition: outcome.disposition,
    occurred_at: outcome.occurred_at || new Date().toISOString(),
    original_draft_text: originalDraftText,
    final_text: outcome.final_text ?? null,
    edit_distance: outcome.edit_distance ?? null,
    latency_ms: latencyMs,
    send_result: outcome.send_result || null,
    notes: outcome.notes || null,
    contract_version: outcome.contract_version || REPLY_TRINITY_CONTRACT_VERSION,
  });
}

async function buildTrinityDraftCandidate(
  message,
  contextSnippets = [],
  recipient = null,
  goldenExamples = [],
) {
  const handles = recipient ? contactStore.getAllHandles(recipient) : [];
  const snapshots = await preparedContextStore.getDraftContextSnapshots(handles);
  const bestSnapshot = snapshots
    .filter((row) => Array.isArray(row.recentThread) && row.recentThread.length > 0)
    .sort((a, b) => Date.parse(String(b.latestInboundTimestamp || 0)) - Date.parse(String(a.latestInboundTimestamp || 0)))[0] || null;
  const history = Array.isArray(bestSnapshot?.recentThread)
    ? bestSnapshot.recentThread
      .map((row) => `[${row.timestamp || "unknown"}] ${row.role === "me" ? "Me" : (recipient || "Contact")}: ${String(row.text || "").trim()}`)
      .join("\n")
    : "";
  const identity = recipient ? contactStore.getProfileContext(recipient) : "";
  return {
    contractVersion: REPLY_TRINITY_CONTRACT_VERSION,
    sourceProduct: "reply",
    recipient: recipient || null,
    message,
    context: {
      identity: identity || "",
      tone: "",
      history: history || "",
      facts: "",
      meta: {
        preparedSnapshotAt: bestSnapshot?.preparedAt || null,
        latestInboundTimestamp: bestSnapshot?.latestInboundTimestamp || null,
      },
    },
    snippets: (contextSnippets || []).map((snippet) => ({
      source: snippet?.source || "",
      path: snippet?.path || "",
      text: snippet?.text || "",
    })),
    goldenExamples: (goldenExamples || []).map((example) => ({
      text: example?.text || "",
      path: example?.path || "",
    })),
  };
}

async function buildThreadSnapshot(
  message,
  contextSnippets = [],
  recipient = null,
  goldenExamples = [],
) {
  const handle = String(recipient || "").trim();
  const channel = inferChannelFromHandle(handle) || "other";
  const handles = handle ? contactStore.getAllHandles(handle) : [];
  const thread = await messageStore.getMessagesForHandles(handles, { limit: 12, offset: 0 });
  const orderedRows = Array.isArray(thread?.rows) ? [...thread.rows].reverse() : [];
  const messages = orderedRows
    .filter((row) => String(row?.text || "").trim())
    .map((row, index) => ({
      message_id: String(row.id || `${handle || "thread"}-${index}`),
      role: row.is_from_me ? "OPERATOR" : "CONTACT",
      text: normalizeThreadMessageText(row.text),
      occurred_at: toIsoTimestamp(row.timestamp, row.text),
      channel: inferRowChannel(row, channel),
      source: String(row.source || inferRowChannel(row, channel)),
      handle: String(row.handle || handle || "unknown"),
    }));
  if (!messages.length && String(message || "").trim()) {
    messages.push({
      message_id: `${handle || "thread"}-latest-inbound`,
      role: "CONTACT",
      text: String(message || "").trim(),
      occurred_at: new Date().toISOString(),
      channel,
      source: channel,
      handle: handle || "unknown",
    });
  }

  return {
    company_id: normalizeReplyCompanyId(),
    thread_ref: buildThreadRef(handle, channel),
    channel,
    contact_handle: handle || "unknown",
    latest_inbound_text: String(message || "").trim(),
    requested_at: new Date().toISOString(),
    messages,
    context_snippets: (contextSnippets || [])
      .filter((snippet) => String(snippet?.text || "").trim())
      .map((snippet) => ({
        source: String(snippet.source || "vector-store"),
        path: String(snippet.path || "snippet://unknown"),
        text: String(snippet.text || "").trim(),
      })),
    golden_examples: (goldenExamples || [])
      .filter((example) => String(example?.text || "").trim())
      .map((example) => ({
        path: String(example.path || "golden://unknown"),
        text: String(example.text || "").trim(),
      })),
    metadata: {
      source_product: "reply",
      runtime_mode: getBrainRuntimeMode(),
      thread_message_count: String(messages.length),
    },
    contract_version: REPLY_TRINITY_CONTRACT_VERSION,
  };
}

async function generateReply(message, contextSnippets = [], recipient = null, goldenExamples = []) {
  const runtimeMode = getBrainRuntimeMode();
  const shadowMode = trinityShadowEnabled();

  if (runtimeMode === "local") {
    return loadLocalBrainRouter().generateReplyWithLocalBrain(
      message,
      contextSnippets,
      recipient,
      goldenExamples,
    );
  }

  if (shadowMode) {
    const legacyResult = await loadLegacyReplyEngine().generateReply(
      message,
      contextSnippets,
      recipient,
      goldenExamples,
    );
    const normalizedLegacy = normalizeSuggestionResult(legacyResult);
    try {
      const threadSnapshot = await buildThreadSnapshot(
        message,
        contextSnippets,
        recipient,
        goldenExamples,
      );
      const rankedDraftSet = await callTrinityRuntime("suggest", threadSnapshot);
      const top = Array.isArray(rankedDraftSet?.drafts) ? rankedDraftSet.drafts[0] : null;
      const provenance = buildRuntimeProvenance(rankedDraftSet || {});
      const shadowComparison = buildShadowComparisonSummary({
        legacySuggestion: normalizedLegacy.suggestion,
        trinitySuggestion: String(top?.draft_text || "").trim(),
      });
      persistShadowComparison({
        comparedAt: new Date().toISOString(),
        runtimeMode: "trinity-shadow",
        handle: String(recipient || "").trim(),
        message: String(message || "").trim(),
        legacySuggestion: normalizedLegacy.suggestion,
        legacyExplanation: normalizedLegacy.explanation,
        trinitySuggestion: String(top?.draft_text || "").trim(),
        trinityRationale: String(top?.rationale || "").trim(),
        cycleId: rankedDraftSet?.cycle_id || null,
        ...provenance,
        comparison: shadowComparison,
      });
      return {
        ...normalizedLegacy,
        contextMeta: {
          ...(normalizedLegacy.contextMeta || {}),
          runtime: "trinity-shadow",
          shadowComparison,
          trinityCycleId: rankedDraftSet?.cycle_id || null,
          trinityTraceRef: provenance.traceRef,
          acceptedArtifactVersion: provenance.acceptedArtifactVersion,
          companyId: threadSnapshot.company_id,
        },
        runtimeMode: "trinity-shadow",
        rankedDraftSet: null,
        trinityDraftCandidate: await buildTrinityDraftCandidate(
          message,
          contextSnippets,
          recipient,
          goldenExamples,
        ),
      };
    } catch (error) {
      console.warn("[reply-runtime] Trinity shadow suggest failed, keeping legacy active:", error.message);
      return {
        ...normalizedLegacy,
        contextMeta: {
          ...(normalizedLegacy.contextMeta || {}),
          runtime: "trinity-shadow",
          shadowError: error.message,
        },
        runtimeMode: "trinity-shadow_fallback_legacy",
      };
    }
  }

  if (trinityDraftsEnabled()) {
    try {
      const threadSnapshot = await buildThreadSnapshot(
        message,
        contextSnippets,
        recipient,
        goldenExamples,
      );
      const rankedDraftSet = await callTrinityRuntime("suggest", threadSnapshot);
      const top = Array.isArray(rankedDraftSet?.drafts) ? rankedDraftSet.drafts[0] : null;
      if (top?.draft_text) {
        const provenance = buildRuntimeProvenance(rankedDraftSet || {});
        return {
          suggestion: String(top.draft_text || "").trim(),
          explanation: String(top.rationale || "").trim(),
          contextMeta: {
            runtime: "trinity",
            cycleId: rankedDraftSet.cycle_id || null,
            traceRef: provenance.traceRef,
            acceptedArtifactVersion: provenance.acceptedArtifactVersion,
            companyId: threadSnapshot.company_id,
          },
          runtimeMode: "trinity",
          rankedDraftSet,
          trinityDraftCandidate: await buildTrinityDraftCandidate(
            message,
            contextSnippets,
            recipient,
            goldenExamples,
          ),
        };
      }
      throw new Error("{trinity} returned no usable draft candidates.");
    } catch (error) {
      throw new Error(`{trinity} suggest failed: ${error.message}`);
    }
  }
  throw new Error(`Unsupported brain runtime mode: ${runtimeMode}`);
}

async function recordDraftOutcome(outcome) {
  if (!outcome || !outcome.cycle_id) {
    return { status: "skipped", reason: "missing_cycle_id" };
  }
  return callTrinityRuntime("record-outcome", buildDraftOutcomeEvent(outcome));
}

async function exportDraftTrace(cycleId) {
  if (!cycleId) {
    return { status: "skipped", reason: "missing_cycle_id" };
  }
  return callTrinityRuntime("export-trace", null, { cycleId });
}

async function proposeTrainingPolicy(options = {}) {
  const learnerKind = String(options.learnerKind || "").trim().toLowerCase();
  const cycleId = String(options.cycleId || "").trim();
  const bundleType = String(
    options.bundleType || REPLY_TRAIN_BUNDLE_TYPE_BY_LEARNER[learnerKind] || "",
  ).trim();
  if (!learnerKind || !REPLY_TRAIN_BUNDLE_TYPE_BY_LEARNER[learnerKind]) {
    throw new Error("Unsupported learner kind. Use tone, brevity, or channel-formatting.");
  }
  if (!cycleId) {
    throw new Error("cycleId is required for bounded train proposals.");
  }
  if (!bundleType) {
    throw new Error("bundleType is required for train proposals.");
  }
  const args = [
    "--learner-kind",
    learnerKind,
    "--cycle-id",
    cycleId,
    "--bundle-type",
    bundleType,
    "--transport",
    String(options.transport || "cli").trim() || "cli",
  ];
  if (options.accept === true) {
    args.push("--accept");
  }
  return callTrinityRuntime("train-propose-policy", null, { args });
}

async function queueMemoryEvent(event) {
  const normalized = buildMemoryEvent(event);
  const row = await trinityEventOutbox.enqueueEvent("memory_event", normalized);
  await drainTrinityEventOutbox(10).catch(() => null);
  return { status: "queued", outbox_id: row.id, payload: normalized };
}

async function queueDocumentRegistration(document) {
  const normalized = buildDocumentRegistration(document);
  const row = await trinityEventOutbox.enqueueEvent("document_registration", normalized);
  await drainTrinityEventOutbox(10).catch(() => null);
  return { status: "queued", outbox_id: row.id, payload: normalized };
}

async function drainTrinityEventOutbox(limit = 25) {
  const pending = await trinityEventOutbox.listPendingEvents(limit);
  const results = [];
  for (const item of pending) {
    try {
      if (item.eventType === "memory_event") {
        await callTrinityRuntime("ingest-memory-event", item.payload);
      } else if (item.eventType === "document_registration") {
        await callTrinityRuntime("register-document", item.payload);
      } else {
        throw new Error(`Unsupported Trinity outbox event type: ${item.eventType}`);
      }
      await trinityEventOutbox.markDelivered(item.id);
      results.push({ id: item.id, status: "delivered" });
    } catch (error) {
      await trinityEventOutbox.markFailed(item.id, String(error?.message || error));
      results.push({ id: item.id, status: "failed", error: String(error?.message || error) });
    }
  }
  return { processed: results.length, results };
}

async function getPreparedDraft({ companyId, threadRef }) {
  if (!companyId || !threadRef) {
    throw new Error("companyId and threadRef are required.");
  }
  return callTrinityRuntime("get-prepared-draft", null, {
    args: ["--company-id", String(companyId), "--thread-ref", String(threadRef)],
  });
}

function getTrinityRuntimeStatusSync() {
  const pythonBin = resolveTrinityPythonBin();
  const trinityRepoRoot = resolveTrinityRuntimeRoot();
  const env = {
    ...process.env,
    PYTHONPATH: buildPythonPath(trinityRepoRoot),
  };
  const result = spawnSync(
    pythonBin,
    ["-m", "trinity_core.cli", "runtime-status", "--adapter", REPLY_TRINITY_ADAPTER],
    {
      cwd: trinityRepoRoot,
      env,
      encoding: "utf-8",
    },
  );
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    if (detail.includes("invalid choice: 'runtime-status'")) {
      const legacy = spawnSync(
        pythonBin,
        ["-m", "trinity_core.cli", "reply-runtime-status", "--adapter", REPLY_TRINITY_ADAPTER],
        {
          cwd: trinityRepoRoot,
          env,
          encoding: "utf-8",
        },
      );
      if (legacy.status === 0) {
        try {
          return JSON.parse(legacy.stdout || "{}");
        } catch (error) {
          throw new Error(`Failed to parse {trinity} runtime status: ${error.message}`);
        }
      }
    }
    throw new Error(detail || "{trinity} runtime status check failed.");
  }
  try {
    return JSON.parse(result.stdout || "{}");
  } catch (error) {
    throw new Error(`Failed to parse {trinity} runtime status: ${error.message}`);
  }
}

async function callTrinityRuntime(command, payload = null, options = {}) {
  if (typeof brainRuntimeTestHooks.trinityRuntimeCall === "function") {
    return brainRuntimeTestHooks.trinityRuntimeCall(command, payload, options);
  }
  const pythonBin = resolveTrinityPythonBin();
  const trinityRepoRoot = resolveTrinityRuntimeRoot();
  const env = {
    ...process.env,
    PYTHONPATH: buildPythonPath(trinityRepoRoot),
  };
  const useLegacyCommandShape = command.startsWith("reply-");
  const args = ["-m", "trinity_core.cli", command];
  if (!useLegacyCommandShape) {
    args.push("--adapter", REPLY_TRINITY_ADAPTER);
  }
  if (options.cycleId) {
    args.push("--cycle-id", String(options.cycleId));
  }
  if (Array.isArray(options.args) && options.args.length) {
    args.push(...options.args.map((value) => String(value)));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, args, {
      cwd: trinityRepoRoot,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const detail = (stderr || stdout || `Trinity runtime exited with code ${code}`).trim();
        const legacyCommand = LEGACY_TRINITY_COMMAND_ALIASES[command];
        if (
          !options.disableLegacyFallback
          && legacyCommand
          && detail.includes(`invalid choice: '${command}'`)
        ) {
          callTrinityRuntime(legacyCommand, payload, {
            ...options,
            disableLegacyFallback: true,
          }).then(resolve).catch(reject);
          return;
        }
        reject(new Error(detail));
        return;
      }
      try {
        resolve(stdout ? JSON.parse(stdout) : {});
      } catch (error) {
        reject(new Error(`Failed to parse Trinity runtime response: ${error.message}`));
      }
    });

    if (payload != null) {
      child.stdin.write(JSON.stringify(payload));
    }
    child.stdin.end();
  });
}

function resolveTrinityPythonBin() {
  const configured = String(process.env.TRINITY_PYTHON_BIN || "").trim();
  const candidates = [
    configured || null,
    "python3",
    "/opt/homebrew/bin/python3",
    "/opt/homebrew/bin/python3.13",
    "/opt/homebrew/bin/python3.12",
    "/usr/local/bin/python3",
    "/usr/local/bin/python3.13",
    "/usr/local/bin/python3.12",
    "/usr/bin/python3",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!pythonVersionSatisfies(candidate)) continue;
    return candidate;
  }

  throw new Error(
    "No compatible Python interpreter found for Trinity runtime. Install Python 3.12+ or set TRINITY_PYTHON_BIN.",
  );
}

function pythonVersionSatisfies(pythonBin) {
  try {
    const probe = spawnSync(
      pythonBin,
      ["-c", "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')"],
      { encoding: "utf-8" },
    );
    if (probe.status !== 0) return false;
    const [majorRaw, minorRaw] = String(probe.stdout || "").trim().split(".");
    const major = Number(majorRaw);
    const minor = Number(minorRaw);
    if (!Number.isInteger(major) || !Number.isInteger(minor)) return false;
    return major > 3 || (major === 3 && minor >= 12);
  } catch (_) {
    return false;
  }
}

function resolveTrinityRuntimeRoot() {
  const configuredRuntime = String(process.env.TRINITY_RUNTIME_ROOT || "").trim();
  if (configuredRuntime) return configuredRuntime;
  const configured = String(process.env.TRINITY_REPO_ROOT || "").trim();
  if (configured) return configured;
  const sharedRepo = "/Users/Shared/Projects/trinity";
  if (fs.existsSync(path.join(sharedRepo, "core", "trinity_core", "cli.py"))) {
    return sharedRepo;
  }
  const bundled = path.resolve(__dirname, "..", "trinity-runtime");
  if (fs.existsSync(path.join(bundled, "core", "trinity_core", "cli.py"))) {
    return bundled;
  }
  return path.resolve(__dirname, "..", "..", "trinity");
}

function buildPythonPath(trinityRepoRoot) {
  const corePath = path.join(trinityRepoRoot, "core");
  return process.env.PYTHONPATH ? `${corePath}${path.delimiter}${process.env.PYTHONPATH}` : corePath;
}

function resolveReplyCompanyId() {
  const explicit = String(process.env.REPLY_RUNTIME_COMPANY_ID || "").trim();
  if (explicit) return explicit;
  return uuidFromStableText("reply.local.runtime");
}

function uuidFromStableText(text) {
  const hash = crypto.createHash("sha1").update(String(text || "")).digest("hex");
  const chars = hash.slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  return [
    chars.slice(0, 8).join(""),
    chars.slice(8, 12).join(""),
    chars.slice(12, 16).join(""),
    chars.slice(16, 20).join(""),
    chars.slice(20, 32).join(""),
  ].join("-");
}

function buildThreadRef(handle, channel) {
  const normalizedHandle = String(handle || "unknown").trim();
  const normalizedChannel = String(channel || "other").trim().toLowerCase();
  return `reply:${normalizedChannel}:${normalizedHandle}`;
}

function normalizeThreadMessageText(raw) {
  const text = stripMessagePrefix(String(raw || "").trim());
  return text || String(raw || "").trim();
}

function toIsoTimestamp(timestamp, fallbackText) {
  if (timestamp) {
    const parsed = new Date(timestamp);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }
  const extracted = extractDateFromText(String(fallbackText || ""));
  if (extracted && !Number.isNaN(extracted.getTime())) {
    return extracted.toISOString();
  }
  return new Date().toISOString();
}

function inferRowChannel(row, fallbackChannel) {
  const rawPath = String(row?.path || "");
  if (rawPath.startsWith("imessage://")) return "imessage";
  if (rawPath.startsWith("whatsapp://")) return "whatsapp";
  if (rawPath.startsWith("mailto:")) return "email";
  if (rawPath.startsWith("linkedin://")) return "linkedin";
  return String(fallbackChannel || inferChannelFromHandle(row?.handle) || "other").toLowerCase();
}

function buildShadowComparisonSummary({ legacySuggestion, trinitySuggestion }) {
  const legacy = String(legacySuggestion || "").trim();
  const trinity = String(trinitySuggestion || "").trim();
  return {
    sameText: legacy === trinity,
    overlapRatio: tokenOverlapRatio(legacy, trinity),
    editDistance: normalizedEditDistance(legacy, trinity),
    legacyLength: legacy.length,
    trinityLength: trinity.length,
  };
}

function persistShadowComparison(payload) {
  if (typeof brainRuntimeTestHooks.persistShadowComparison === "function") {
    brainRuntimeTestHooks.persistShadowComparison(payload);
    return;
  }
  try {
    ensureDataHome();
    const logFile = dataPath("shadow", "trinity-draft-comparisons.jsonl");
    fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 });
    fs.appendFileSync(logFile, `${JSON.stringify(payload)}\n`, { encoding: "utf-8", mode: 0o600 });
  } catch (error) {
    console.warn("[reply-runtime] Failed to persist Trinity shadow comparison:", error.message);
  }
}

function readShadowComparisons(limit = 20) {
  try {
    ensureDataHome();
    const logFile = dataPath("shadow", "trinity-draft-comparisons.jsonl");
    if (!fs.existsSync(logFile)) return [];
    const lines = fs
      .readFileSync(logFile, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    return lines
      .slice(-Math.max(1, Math.min(Number(limit) || 20, 500)))
      .reverse()
      .map((line) => JSON.parse(line));
  } catch (error) {
    console.warn("[reply-runtime] Failed to read Trinity shadow comparisons:", error.message);
    return [];
  }
}

function normalizedEditDistance(left, right) {
  const source = String(left || "");
  const target = String(right || "");
  if (!source && !target) return 0;
  const rows = Array.from({ length: source.length + 1 }, () => new Array(target.length + 1).fill(0));
  for (let i = 0; i <= source.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= target.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= source.length; i += 1) {
    for (let j = 1; j <= target.length; j += 1) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost,
      );
    }
  }
  return rows[source.length][target.length] / Math.max(source.length, target.length);
}

function tokenOverlapRatio(left, right) {
  const leftTokens = new Set(String(left || "").toLowerCase().split(/\s+/).filter(Boolean));
  const rightTokens = new Set(String(right || "").toLowerCase().split(/\s+/).filter(Boolean));
  if (!leftTokens.size && !rightTokens.size) return 1;
  const union = new Set([...leftTokens, ...rightTokens]);
  let overlap = 0;
  for (const token of union) {
    if (leftTokens.has(token) && rightTokens.has(token)) overlap += 1;
  }
  return Number((overlap / Math.max(union.size, 1)).toFixed(4));
}

function setBrainRuntimeTestHooks(hooks = {}) {
  brainRuntimeTestHooks.legacyGenerateReply = hooks.legacyGenerateReply || null;
  brainRuntimeTestHooks.localGenerateReply = hooks.localGenerateReply || null;
  brainRuntimeTestHooks.trinityRuntimeCall = hooks.trinityRuntimeCall || null;
  brainRuntimeTestHooks.persistShadowComparison = hooks.persistShadowComparison || null;
}

function clearBrainRuntimeTestHooks() {
  setBrainRuntimeTestHooks({});
}

module.exports = {
  allowExperimentalBrainModes,
  allowLegacyBrain,
  buildDocumentRegistration,
  buildDraftOutcomeFact,
  buildDraftOutcomeEvent,
  buildMemoryEvent,
  buildRuntimeProvenance,
  buildShadowComparisonSummary,
  buildThreadSnapshot,
  buildTrinityDraftCandidate,
  clearBrainRuntimeTestHooks,
  classifyRuntimeFailure,
  drainTrinityEventOutbox,
  exportDraftTrace,
  generateReply,
  getBrainRuntimeMode,
  getPreparedDraft,
  normalizeSuggestionResult,
  normalizeReplyCompanyId,
  normalizedEditDistance,
  persistShadowComparison,
  pythonVersionSatisfies,
  proposeTrainingPolicy,
  queueDocumentRegistration,
  queueMemoryEvent,
  readShadowComparisons,
  recordDraftOutcome,
  releaseRuntimeEnforced,
  resolveReplyCompanyId,
  sanitizeDraftContext,
  setBrainRuntimeTestHooks,
  resolveTrinityPythonBin,
  resolveTrinityRuntimeRoot,
  getTrinityRuntimeStatusSync,
  tokenOverlapRatio,
  trinityDraftsEnabled,
  trinityShadowEnabled,
};
