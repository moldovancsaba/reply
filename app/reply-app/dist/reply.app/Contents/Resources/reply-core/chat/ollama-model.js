/**
 * Single place to resolve which Ollama tag Reply uses for local LLM calls.
 * Supported install set (see chat/.env.example): gemma3:1b, granite4:350m,
 * MichelRosselli/apertus:latest, qwen2.5:7b, llama3.2:3b.
 */

const DEFAULT_MODEL = "gemma3:1b";
/** Profile / ✨ Analyze Ollama path (`kyc-agent.js`). */
const DEFAULT_KYC_OLLAMA_MODEL = "qwen2.5:7b";
/** LanceDB annotation batch when `REPLY_ANNOTATION_MODEL` and `REPLY_OLLAMA_MODEL` are unset. */
const DEFAULT_ANNOTATION_OLLAMA_MODEL = "granite4:350m";

function getReplyOllamaModel() {
  return String(process.env.REPLY_OLLAMA_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
}

/** KYC-style extraction (`kyc-agent.js`). */
function getKycOllamaModel() {
  return (
    String(process.env.REPLY_KYC_OLLAMA_MODEL || DEFAULT_KYC_OLLAMA_MODEL).trim() ||
    DEFAULT_KYC_OLLAMA_MODEL
  );
}

/** Vector annotation batch job (annotation-agent.js). */
function getAnnotationOllamaModel() {
  const raw =
    String(
      process.env.REPLY_ANNOTATION_MODEL ||
        process.env.REPLY_OLLAMA_MODEL ||
        DEFAULT_ANNOTATION_OLLAMA_MODEL
    ).trim() || DEFAULT_MODEL;
  return raw;
}

module.exports = {
  getReplyOllamaModel,
  getKycOllamaModel,
  getAnnotationOllamaModel,
  DEFAULT_MODEL,
  DEFAULT_KYC_OLLAMA_MODEL,
  DEFAULT_ANNOTATION_OLLAMA_MODEL,
};
