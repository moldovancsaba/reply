/**
 * AI / provider runtime from persisted settings (reply#52 follow-up).
 * Applies non-secret and secret fields to process.env for this process; syncToEnv
 * mirrors a subset to chat/.env for the worker on restart.
 */

const { readSettings, withDefaults } = require("./settings-store.js");

/**
 * Merge Settings → process.env (hub, worker after load, or immediately after POST /api/settings).
 * Empty strings skip that key so existing .env / shell values remain in effect until restart.
 * @param {object} [settings] - Raw settings object; defaults to readSettings().
 */
function applyAiSettingsToProcessEnv(settings) {
  let cfg;
  try {
    cfg = withDefaults(settings !== undefined && settings !== null ? settings : readSettings());
  } catch {
    return;
  }
  const ai = cfg.ai || {};

  if (ai.ollamaHost && String(ai.ollamaHost).trim()) {
    let h = String(ai.ollamaHost).trim();
    if (!/^https?:\/\//i.test(h)) h = `http://${h}`;
    process.env.OLLAMA_HOST = h.replace(/\/$/, "");
  } else if (Number(ai.ollamaPort) > 0) {
    const p = Math.max(1, Math.min(Number(ai.ollamaPort), 65535));
    process.env.OLLAMA_HOST = `http://127.0.0.1:${p}`;
  }

  if (ai.ollamaModel && String(ai.ollamaModel).trim()) {
    process.env.REPLY_OLLAMA_MODEL = String(ai.ollamaModel).trim();
  } else {
    delete process.env.REPLY_OLLAMA_MODEL;
  }

  if (ai.annotationOllamaModel && String(ai.annotationOllamaModel).trim()) {
    process.env.REPLY_ANNOTATION_MODEL = String(ai.annotationOllamaModel).trim();
  } else {
    delete process.env.REPLY_ANNOTATION_MODEL;
  }

  if (ai.kycOllamaModel && String(ai.kycOllamaModel).trim()) {
    process.env.REPLY_KYC_OLLAMA_MODEL = String(ai.kycOllamaModel).trim();
  } else {
    delete process.env.REPLY_KYC_OLLAMA_MODEL;
  }

  if (ai.openclawBinary && String(ai.openclawBinary).trim()) {
    process.env.OPENCLAW_BIN = String(ai.openclawBinary).trim();
  } else {
    delete process.env.OPENCLAW_BIN;
  }

  if (ai.openclawGatewayUrl && String(ai.openclawGatewayUrl).trim()) {
    process.env.REPLY_OPENCLAW_GATEWAY_URL = String(ai.openclawGatewayUrl).trim();
  }
  /* Empty UI field must not wipe `chat/.env.local` (loadReplyEnv already set these). */

  if (ai.openclawGatewayToken && String(ai.openclawGatewayToken).trim()) {
    process.env.REPLY_OPENCLAW_GATEWAY_TOKEN = String(ai.openclawGatewayToken).trim();
  }

}

function resolveOllamaHttpBase() {
  const raw = String(process.env.OLLAMA_HOST || "").trim();
  if (raw) return raw.replace(/\/$/, "");
  const port = String(process.env.OLLAMA_PORT || "11434").trim() || "11434";
  return `http://127.0.0.1:${port}`;
}

/**
 * Parsed origin for Node `http` / `https` requests to Ollama.
 * When the URL omits a port, uses 11434 for HTTP (Ollama default) and 443 for HTTPS.
 * @returns {{ hostname: string, port: number, isHttps: boolean }}
 */
function getOllamaUrlParts() {
  const base = resolveOllamaHttpBase();
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(base) ? base : `http://${base}`);
  } catch {
    url = new URL("http://127.0.0.1:11434");
  }
  const isHttps = url.protocol === "https:";
  const hasPort = url.port !== "";
  const port = hasPort ? Number(url.port) : isHttps ? 443 : 11434;
  return { hostname: url.hostname, port, isHttps };
}

/** @returns {'auto'|'ollama'} */
function getDraftRuntimeMode() {
  try {
    const v = String(withDefaults(readSettings())?.ai?.draftRuntime || "auto").toLowerCase();
    if (v === "ollama") return v;
  } catch {
    /* ignore */
  }
  return "auto";
}

module.exports = {
  applyAiSettingsToProcessEnv,
  resolveOllamaHttpBase,
  getOllamaUrlParts,
  getDraftRuntimeMode,
};
