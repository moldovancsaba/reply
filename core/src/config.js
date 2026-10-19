import os from "node:os";
import path from "node:path";
import { isRegion } from "./identity/normalize.js";
import { hasAccounts } from "./imap/accounts.js";

// Connectors enabled when REPLY_CORE_CONNECTORS is unset. Connector issues add their ids here.
export const DEFAULT_ENABLED_IDS = ["imessage", "contacts", "apple-mail"];
const LEVELS = ["debug", "info", "warn", "error"];

export class ConfigError extends Error {}

export function defaultHome() {
    return path.join(os.homedir(), "Library", "Application Support", "reply-core");
}

// Validates the environment once at start. Throws ConfigError naming the exact setting.
export function loadConfig(env = process.env) {
    const portRaw = env.REPLY_CORE_PORT ?? "45511";
    const port = Number(portRaw);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        throw new ConfigError("REPLY_CORE_PORT must be 1024-65535");
    }

    const logLevel = (env.REPLY_CORE_LOG_LEVEL || "info").toLowerCase();
    if (!LEVELS.includes(logLevel)) {
        throw new ConfigError(`REPLY_CORE_LOG_LEVEL must be one of ${LEVELS.join(", ")}`);
    }

    const allowedOrigins = (env.REPLY_CORE_ALLOWED_ORIGINS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    for (const origin of allowedOrigins) {
        try {
            const u = new URL(origin);
            if (!/^https?:$/.test(u.protocol) || u.origin !== origin) throw new Error("shape");
        } catch {
            throw new ConfigError(`REPLY_CORE_ALLOWED_ORIGINS contains an invalid origin: ${origin}`);
        }
    }

    // unset or empty -> DEFAULT_ENABLED_IDS; the single word `none` -> no connectors at all
    const rawConnectors = (env.REPLY_CORE_CONNECTORS ?? "").trim().toLowerCase();
    const connectors = rawConnectors === "none" ? [] : rawConnectors.split(",").map((s) => s.trim()).filter(Boolean);
    if (connectors.some((c) => !/^[a-z0-9-]+$/.test(c))) {
        throw new ConfigError("REPLY_CORE_CONNECTORS must be a comma-separated list of connector ids");
    }
    const intervals = {};
    for (const [k, v] of Object.entries(env)) {
        const m = /^REPLY_CORE_([A-Z0-9_]+)_INTERVAL_MS$/.exec(k);
        if (!m) continue;
        const ms = Number(v);
        if (!Number.isInteger(ms) || ms < 1000) throw new ConfigError(`${k} must be an integer of at least 1000`);
        intervals[m[1].toLowerCase().replace(/_/g, "-")] = ms;
    }

    const defaultRegion = (env.REPLY_CORE_DEFAULT_REGION || "HU").toUpperCase();
    if (!isRegion(defaultRegion)) throw new ConfigError("REPLY_CORE_DEFAULT_REGION must be a two-letter country code such as HU or US");

    // Drafting is off unless asked for, and the only provider is a local Ollama. A non-loopback URL needs an explicit opt-in.
    const llm = (env.REPLY_CORE_LLM || "off").toLowerCase();
    if (!["off", "ollama"].includes(llm)) throw new ConfigError("REPLY_CORE_LLM must be off or ollama");
    const ollamaUrl = (env.REPLY_CORE_OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
    let ollamaHost;
    try {
        const u = new URL(ollamaUrl);
        if (!/^https?:$/.test(u.protocol)) throw new Error("scheme");
        ollamaHost = u.hostname.replace(/^\[|\]$/g, "");
    } catch {
        throw new ConfigError("REPLY_CORE_OLLAMA_URL must be an http(s) URL");
    }
    const allowRemoteLlm = env.REPLY_CORE_ALLOW_REMOTE_LLM === "1";
    if (llm === "ollama" && !["127.0.0.1", "localhost", "::1"].includes(ollamaHost) && !allowRemoteLlm) {
        throw new ConfigError("REPLY_CORE_OLLAMA_URL is not on this machine: conversation text would leave it. Set REPLY_CORE_ALLOW_REMOTE_LLM=1 only if you mean that");
    }
    const ollamaModel = env.REPLY_CORE_OLLAMA_MODEL || null;
    if (llm === "ollama" && !ollamaModel) throw new ConfigError("REPLY_CORE_OLLAMA_MODEL must be set when REPLY_CORE_LLM=ollama");

    const home = env.REPLY_CORE_HOME ? path.resolve(env.REPLY_CORE_HOME) : defaultHome();
    const unknownKeys = Object.keys(env).filter(
        (k) => k.startsWith("REPLY_CORE_") && !KNOWN_KEYS.has(k) && !/_INTERVAL_MS$/.test(k),
    );
    // IMAP joins the default connectors once an account has been added (see `reply-core accounts add-imap`)
    return { home, port, logLevel, allowedOrigins, connectors: rawConnectors === "none" ? [] : connectors.length ? connectors : [...DEFAULT_ENABLED_IDS, ...(hasAccounts(home) ? ["imap"] : [])], llm: { provider: llm, model: ollamaModel, url: ollamaUrl }, imessageDb: env.REPLY_CORE_IMESSAGE_DB || null, mailRoot: env.REPLY_CORE_MAIL_ROOT || null, whatsappDb: env.REPLY_CORE_WHATSAPP_DB || null, uiDir: env.REPLY_CORE_UI_DIR ? path.resolve(env.REPLY_CORE_UI_DIR) : path.resolve(import.meta.dirname, "..", "ui", "dist"), intervals, defaultRegion, unknownKeys };
}

const KNOWN_KEYS = new Set([
    "REPLY_CORE_HOME",
    "REPLY_CORE_PORT",
    "REPLY_CORE_LOG_LEVEL",
    "REPLY_CORE_ALLOWED_ORIGINS",
    "REPLY_CORE_CONNECTORS",
    "REPLY_CORE_DEFAULT_REGION",
    "REPLY_CORE_IMESSAGE_DB",
    "REPLY_CORE_MAIL_ROOT",
    "REPLY_CORE_WHATSAPP_DB",
    "REPLY_CORE_UI_DIR",
    "REPLY_CORE_HELPER",
    "REPLY_CORE_LLM",
    "REPLY_CORE_OLLAMA_MODEL",
    "REPLY_CORE_OLLAMA_URL",
    "REPLY_CORE_ALLOW_REMOTE_LLM",
]);
