const crypto = require("crypto");
const path = require("path");
const { spawn } = require("child_process");

const legacyReplyEngine = require("./reply-engine.js");
const { assembleReplyContext } = require("./context-engine.js");
const contactStore = require("./contact-store.js");
const messageStore = require("./message-store.js");
const { pathPrefixesForHandle, inferChannelFromHandle, extractDateFromText, stripMessagePrefix } = require("./utils/chat-utils.js");

const REPLY_TRINITY_CONTRACT_VERSION = "trinity.reply.v1alpha1";

function getBrainRuntimeMode() {
  const raw = String(process.env.REPLY_BRAIN_RUNTIME || "legacy").trim().toLowerCase();
  return raw || "legacy";
}

function trinityDraftsEnabled() {
  const flag = String(process.env.USE_TRINITY_DRAFTS || "").trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  return getBrainRuntimeMode() === "trinity";
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
      throw new Error("Trinity returned no usable draft candidates.");
    } catch (error) {
      console.warn("[reply-runtime] Trinity suggest failed, falling back to legacy:", error.message);
      const legacyResult = await legacyReplyEngine.generateReply(
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

  const legacyResult = await legacyReplyEngine.generateReply(
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
  const pythonBin = process.env.TRINITY_PYTHON_BIN || "python3";
  const trinityRepoRoot = resolveTrinityRepoRoot();
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

function resolveTrinityRepoRoot() {
  const configured = String(process.env.TRINITY_REPO_ROOT || "").trim();
  if (configured) return configured;
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

module.exports = {
  buildThreadSnapshot,
  buildTrinityDraftCandidate,
  exportDraftTrace,
  generateReply,
  getBrainRuntimeMode,
  normalizeSuggestionResult,
  recordDraftOutcome,
  resolveReplyCompanyId,
  trinityDraftsEnabled,
};
