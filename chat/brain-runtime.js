const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const { assembleReplyContext } = require("./context-engine.js");
const contactStore = require("./contact-store.js");
const messageStore = require("./message-store.js");
const { ensureDataHome, dataPath } = require("./app-paths.js");
const { pathPrefixesForHandle, inferChannelFromHandle, extractDateFromText, stripMessagePrefix } = require("./utils/chat-utils.js");

const REPLY_TRINITY_CONTRACT_VERSION = "trinity.reply.v1alpha1";
const TRUE_VALUES = new Set(["1", "true", "yes"]);

function envFlagEnabled(name) {
  const value = String(process.env[name] || "").trim().toLowerCase();
  return TRUE_VALUES.has(value);
}

function releaseRuntimeEnforced() {
  return envFlagEnabled("REPLY_RELEASE_MODE") || envFlagEnabled("REPLY_BUNDLED_APP");
}

function allowLegacyBrain() {
  return !releaseRuntimeEnforced() && envFlagEnabled("REPLY_ALLOW_LEGACY_BRAIN");
}

function allowExperimentalBrainModes() {
  return !releaseRuntimeEnforced() && envFlagEnabled("REPLY_ALLOW_EXPERIMENTAL_BRAIN_MODES");
}

function loadLegacyReplyEngine() {
  return require("./reply-engine.js");
}

function getBrainRuntimeMode() {
  const raw = String(process.env.REPLY_BRAIN_RUNTIME || "trinity").trim().toLowerCase() || "trinity";
  if (raw === "legacy") {
    return allowLegacyBrain() ? "legacy" : "trinity";
  }
  if (raw === "trinity-shadow") {
    return allowExperimentalBrainModes() ? "trinity-shadow" : "trinity";
  }
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

async function buildTrinityDraftCandidate(
  message,
  contextSnippets = [],
  recipient = null,
  goldenExamples = [],
) {
  const context = await assembleReplyContext(message, recipient);
  return {
    contractVersion: REPLY_TRINITY_CONTRACT_VERSION,
    sourceProduct: "reply",
    recipient: recipient || null,
    message,
    context: {
      identity: context.identity || "",
      tone: context.tone || "",
      history: context.history || "",
      facts: context.facts || "",
      meta: context.meta || null,
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
    company_id: resolveReplyCompanyId(),
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
  };
}

async function generateReply(message, contextSnippets = [], recipient = null, goldenExamples = []) {
  const runtimeMode = getBrainRuntimeMode();
  const shadowMode = trinityShadowEnabled();

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
      const rankedDraftSet = await callTrinityRuntime("reply-suggest", threadSnapshot);
      const top = Array.isArray(rankedDraftSet?.drafts) ? rankedDraftSet.drafts[0] : null;
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
        traceRef: rankedDraftSet?.trace_ref || null,
        comparison: shadowComparison,
      });
      return {
        ...normalizedLegacy,
        contextMeta: {
          ...(normalizedLegacy.contextMeta || {}),
          runtime: "trinity-shadow",
          shadowComparison,
          trinityCycleId: rankedDraftSet?.cycle_id || null,
          trinityTraceRef: rankedDraftSet?.trace_ref || null,
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
      const rankedDraftSet = await callTrinityRuntime("reply-suggest", threadSnapshot);
      const top = Array.isArray(rankedDraftSet?.drafts) ? rankedDraftSet.drafts[0] : null;
      if (top?.draft_text) {
        return {
          suggestion: String(top.draft_text || "").trim(),
          explanation: String(top.rationale || "").trim(),
          contextMeta: {
            runtime: "trinity",
            cycleId: rankedDraftSet.cycle_id || null,
            traceRef: rankedDraftSet.trace_ref || null,
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
      if (!allowLegacyBrain()) {
        throw new Error(`{trinity} suggest failed: ${error.message}`);
      }
      console.warn("[reply-runtime] Trinity suggest failed, falling back to legacy:", error.message);
      const legacyResult = await loadLegacyReplyEngine().generateReply(
        message,
        contextSnippets,
        recipient,
        goldenExamples,
      );
      const normalized = normalizeSuggestionResult(legacyResult);
      return {
        ...normalized,
        runtimeMode: `${runtimeMode || "trinity"}_fallback_legacy`,
      };
    }
  }

  const legacyResult = await loadLegacyReplyEngine().generateReply(
    message,
    contextSnippets,
    recipient,
    goldenExamples,
  );

  if (runtimeMode === "legacy") {
    return legacyResult;
  }

  const normalized = normalizeSuggestionResult(legacyResult);
  return {
    ...normalized,
    runtimeMode,
    trinityDraftCandidate: await buildTrinityDraftCandidate(
      message,
      contextSnippets,
      recipient,
      goldenExamples,
    ),
  };
}

async function recordDraftOutcome(outcome) {
  if (!outcome || !outcome.cycle_id) {
    return { status: "skipped", reason: "missing_cycle_id" };
  }
  return callTrinityRuntime("reply-record-outcome", outcome);
}

async function exportDraftTrace(cycleId) {
  if (!cycleId) {
    return { status: "skipped", reason: "missing_cycle_id" };
  }
  return callTrinityRuntime("reply-export-trace", null, { cycleId });
}

async function callTrinityRuntime(command, payload = null, options = {}) {
  const pythonBin = resolveTrinityPythonBin();
  const trinityRepoRoot = resolveTrinityRuntimeRoot();
  const env = {
    ...process.env,
    PYTHONPATH: buildPythonPath(trinityRepoRoot),
  };
  const args = ["-m", "trinity_core.cli", command];
  if (options.cycleId) {
    args.push("--cycle-id", String(options.cycleId));
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
        reject(new Error((stderr || stdout || `Trinity runtime exited with code ${code}`).trim()));
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

module.exports = {
  allowExperimentalBrainModes,
  allowLegacyBrain,
  buildShadowComparisonSummary,
  buildThreadSnapshot,
  buildTrinityDraftCandidate,
  exportDraftTrace,
  generateReply,
  getBrainRuntimeMode,
  normalizeSuggestionResult,
  normalizedEditDistance,
  persistShadowComparison,
  pythonVersionSatisfies,
  readShadowComparisons,
  recordDraftOutcome,
  releaseRuntimeEnforced,
  resolveReplyCompanyId,
  resolveTrinityPythonBin,
  resolveTrinityRuntimeRoot,
  tokenOverlapRatio,
  trinityDraftsEnabled,
  trinityShadowEnabled,
};
