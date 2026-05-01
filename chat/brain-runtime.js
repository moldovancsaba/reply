const legacyReplyEngine = require("./reply-engine.js");
const { assembleReplyContext } = require("./context-engine.js");

function getBrainRuntimeMode() {
  const raw = String(process.env.REPLY_BRAIN_RUNTIME || "legacy").trim().toLowerCase();
  return raw || "legacy";
}

function normalizeSuggestionResult(result) {
  if (typeof result === "string") {
    return {
      suggestion: result,
      explanation: "",
      contextMeta: null,
    };
  }

  return {
    suggestion: String(result?.suggestion || "").trim(),
    explanation: String(result?.explanation || "").trim(),
    contextMeta: result?.contextMeta || null,
    runtimeMode: result?.runtimeMode || null,
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
    contractVersion: "trinity.reply.v1alpha1",
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

async function generateReply(message, contextSnippets = [], recipient = null, goldenExamples = []) {
  const runtimeMode = getBrainRuntimeMode();
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

module.exports = {
  buildTrinityDraftCandidate,
  generateReply,
  getBrainRuntimeMode,
  normalizeSuggestionResult,
};
