/**
 * Single place to resolve which Ollama tag Reply uses for local LLM calls.
 * Older installs and docs used llama3.2:3b; we remap that so suggestions/KYC paths don't break.
 */

const LEGACY_SHIPPED_DEFAULT = "llama3.2:3b";
/** Lightest Gemma 4 on Ollama (effective ~2B edge). Heavier: gemma4:e4b, gemma4:26b, gemma4:31b. */
const DEFAULT_MODEL = "gemma4:e2b";

function remapLegacy(modelName, label) {
  const s = String(modelName || "").trim();
  if (s === LEGACY_SHIPPED_DEFAULT) {
    const next =
      String(process.env.REPLY_OLLAMA_MODEL_LEGACY_MAP || DEFAULT_MODEL).trim() ||
      DEFAULT_MODEL;
    console.warn(
      `[ollama-model] ${label}: "${LEGACY_SHIPPED_DEFAULT}" is deprecated; using "${next}". ` +
        `Set REPLY_OLLAMA_MODEL to a tag from \`ollama list\` (e.g. gemma4:e2b).`
    );
    return next;
  }
  return s;
}

/** Suggest / extractKYC / worker draft (reply-engine.js). */
function getReplyOllamaModel() {
  const raw = String(process.env.REPLY_OLLAMA_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  return remapLegacy(raw, "REPLY_OLLAMA_MODEL");
}

/** Vector annotation batch job (annotation-agent.js). */
function getAnnotationOllamaModel() {
  const raw =
    String(
      process.env.REPLY_ANNOTATION_MODEL ||
        process.env.REPLY_OLLAMA_MODEL ||
        DEFAULT_MODEL
    ).trim() || DEFAULT_MODEL;
  return remapLegacy(raw, "REPLY_ANNOTATION_MODEL");
}

module.exports = {
  getReplyOllamaModel,
  getAnnotationOllamaModel,
  DEFAULT_MODEL,
  LEGACY_SHIPPED_DEFAULT,
};
