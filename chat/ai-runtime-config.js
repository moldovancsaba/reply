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

  if (ai.openclawBinary && String(ai.openclawBinary).trim()) {
    process.env.OPENCLAW_BIN = String(ai.openclawBinary).trim();
  } else {
    delete process.env.OPENCLAW_BIN;
  }

  if (ai.openclawGatewayUrl && String(ai.openclawGatewayUrl).trim()) {
    process.env.REPLY_OPENCLAW_GATEWAY_URL = String(ai.openclawGatewayUrl).trim();
  } else {
    delete process.env.REPLY_OPENCLAW_GATEWAY_URL;
  }

  if (ai.openclawGatewayToken && String(ai.openclawGatewayToken).trim()) {
    process.env.REPLY_OPENCLAW_GATEWAY_TOKEN = String(ai.openclawGatewayToken).trim();
  } else {
    delete process.env.REPLY_OPENCLAW_GATEWAY_TOKEN;
  }

  if (ai.hatoriApiUrl && String(ai.hatoriApiUrl).trim()) {
    let u = String(ai.hatoriApiUrl).trim();
    if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
    process.env.HATORI_API_URL = u.replace(/\/$/, "");
  } else {
    delete process.env.HATORI_API_URL;
  }
}

function resolveOllamaHttpBase() {
  const raw = String(process.env.OLLAMA_HOST || "").trim();
  if (raw) return raw.replace(/\/$/, "");
  const port = String(process.env.OLLAMA_PORT || "11434").trim() || "11434";
  return `http://127.0.0.1:${port}`;
}

/** @returns {'auto'|'ollama'|'hatori'} */
function getDraftRuntimeMode() {
  try {
    const v = String(withDefaults(readSettings())?.ai?.draftRuntime || "auto").toLowerCase();
    if (v === "ollama" || v === "hatori") return v;
  } catch {
    /* ignore */
  }
  return "auto";
}

/** Use Hatori for generateReply when enabled and policy is not ollama-only. */
function shouldRouteDraftToHatori() {
  const mode = getDraftRuntimeMode();
  if (mode === "ollama") return false;
  if (mode === "hatori") return process.env.REPLY_USE_HATORI === "1";
  return process.env.REPLY_USE_HATORI === "1";
}

/** Ingest to Hatori before suggest when Hatori is on and not ollama-only. */
function shouldRunHatoriIngestBeforeSuggest() {
  return process.env.REPLY_USE_HATORI === "1" && getDraftRuntimeMode() !== "ollama";
}

module.exports = {
  applyAiSettingsToProcessEnv,
  resolveOllamaHttpBase,
  getDraftRuntimeMode,
  shouldRouteDraftToHatori,
  shouldRunHatoriIngestBeforeSuggest,
};
