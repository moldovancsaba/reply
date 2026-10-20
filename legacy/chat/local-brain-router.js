const { Ollama } = require("ollama");

const { resolveOllamaHttpBase } = require("./ai-runtime-config.js");
const { getReplyOllamaModel } = require("./ollama-model.js");

function getOllamaClient() {
  return new Ollama({ host: resolveOllamaHttpBase() });
}

function getRoleModel(role) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  const envName = normalizedRole ? `REPLY_${normalizedRole.toUpperCase()}_OLLAMA_MODEL` : "";
  const explicit = envName ? String(process.env[envName] || "").trim() : "";
  return explicit || getReplyOllamaModel();
}

function unwrapSuggestionResult(result) {
  if (typeof result === "string") {
    return {
      suggestion: String(result || "").trim(),
      explanation: "",
      contextMeta: null,
    };
  }
  return {
    suggestion: String(result?.suggestion || "").trim(),
    explanation: String(result?.explanation || "").trim(),
    contextMeta: result?.contextMeta || null,
  };
}

function normalizeDraftText(value) {
  return String(value || "").trim().replace(/^"(.*)"$/, "$1");
}

async function runWriterPass({ message, draftText, explanation }) {
  const prompt = [
    "You are the writer in Reply's local drafting pipeline.",
    "Tighten the draft into a send-ready reply.",
    "Keep it brief, direct, and natural.",
    "Preserve language, facts, channel fit, and intent.",
    "Do not add facts not present in the incoming message or the draft.",
    "",
    "INCOMING MESSAGE:",
    `"${String(message || "").trim()}"`,
    "",
    "DRAFTER NOTES:",
    explanation ? explanation : "(none)",
    "",
    "DRAFT:",
    `"${String(draftText || "").trim()}"`,
    "",
    "Return only the final reply text. Keep it to 1-2 sentences unless the draft clearly requires more.",
  ].join("\n");

  const response = await getOllamaClient().chat({
    model: getRoleModel("writer"),
    messages: [{ role: "user", content: prompt }],
  });

  return normalizeDraftText(response?.message?.content || "");
}

function parseJudgeDecision(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    const winner = String(parsed?.winner || "").trim().toLowerCase();
    const rationale = String(parsed?.rationale || "").trim();
    if (winner === "drafter" || winner === "writer") {
      return { winner, rationale };
    }
  } catch (_) {
    return null;
  }
  return null;
}

async function runJudgePass({ message, drafter, writer }) {
  const prompt = [
    "You are the judge in Reply's local drafting pipeline.",
    "Choose the stronger final reply for the operator.",
    "Prefer correctness, directness, and natural tone.",
    "Reject hallucinated facts, fluff, and wording that feels unnatural.",
    "",
    "INCOMING MESSAGE:",
    `"${String(message || "").trim()}"`,
    "",
    "CANDIDATE DRAFTER:",
    `"${String(drafter || "").trim()}"`,
    "",
    "CANDIDATE WRITER:",
    `"${String(writer || "").trim()}"`,
    "",
    'Return JSON only: {"winner":"drafter|writer","rationale":"short reason"}.',
  ].join("\n");

  const response = await getOllamaClient().chat({
    model: getRoleModel("judge"),
    messages: [{ role: "user", content: prompt }],
    format: "json",
  });

  return parseJudgeDecision(response?.message?.content || "");
}

async function generateReplyWithLocalBrain(message, contextSnippets = [], recipient = null, goldenExamples = []) {
  const legacyEngine = require("./reply-engine.js");
  const drafterBase = unwrapSuggestionResult(
    await legacyEngine.generateReply(message, contextSnippets, recipient, goldenExamples),
  );

  const drafterText = normalizeDraftText(drafterBase.suggestion);
  if (!drafterText) {
    return {
      suggestion: "",
      explanation: drafterBase.explanation || "Local drafter returned no text.",
      contextMeta: {
        ...(drafterBase.contextMeta || {}),
        runtime: "local",
        selectedStage: "drafter",
        stageModels: {
          drafter: "reply-engine",
          writer: getRoleModel("writer"),
          judge: getRoleModel("judge"),
        },
      },
      runtimeMode: "local",
      rankedDraftSet: null,
      trinityDraftCandidate: null,
    };
  }

  let writerText = "";
  let writerError = null;
  try {
    writerText = await runWriterPass({
      message,
      draftText: drafterText,
      explanation: drafterBase.explanation,
    });
  } catch (error) {
    writerError = String(error?.message || error);
  }

  let selectedStage = "drafter";
  let suggestion = drafterText;
  let judgeRationale = drafterBase.explanation || "";

  if (writerText) {
    suggestion = writerText;
    selectedStage = "writer";
    judgeRationale = "Writer tightened the draft for send-ready brevity.";
    try {
      const decision = await runJudgePass({
        message,
        drafter: drafterText,
        writer: writerText,
      });
      if (decision?.winner === "drafter") {
        suggestion = drafterText;
        selectedStage = "drafter";
      } else if (decision?.winner === "writer") {
        suggestion = writerText;
        selectedStage = "writer";
      }
      if (decision?.rationale) judgeRationale = decision.rationale;
    } catch (error) {
      judgeRationale = writerError
        ? drafterBase.explanation || ""
        : "Writer draft selected because judge pass was unavailable.";
    }
  }

  const explanationParts = [];
  if (judgeRationale) explanationParts.push(judgeRationale);
  if (writerError) explanationParts.push(`Writer fallback: ${writerError}`);

  return {
    suggestion,
    explanation: explanationParts.join(" ").trim(),
    contextMeta: {
      ...(drafterBase.contextMeta || {}),
      runtime: "local",
      selectedStage,
      stageModels: {
        drafter: "reply-engine",
        writer: getRoleModel("writer"),
        judge: getRoleModel("judge"),
      },
      candidates: {
        drafter: drafterText,
        writer: writerText || null,
      },
    },
    runtimeMode: "local",
    rankedDraftSet: null,
    trinityDraftCandidate: null,
  };
}

module.exports = {
  generateReplyWithLocalBrain,
  getRoleModel,
  parseJudgeDecision,
  unwrapSuggestionResult,
};
