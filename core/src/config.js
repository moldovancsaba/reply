import os from "node:os";
import path from "node:path";

// Connectors enabled when REPLY_CORE_CONNECTORS is unset. Connector issues add their ids here.
export const DEFAULT_ENABLED_IDS = [];
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

    const connectors = (env.REPLY_CORE_CONNECTORS ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
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

    const home = env.REPLY_CORE_HOME ? path.resolve(env.REPLY_CORE_HOME) : defaultHome();
    const unknownKeys = Object.keys(env).filter(
        (k) => k.startsWith("REPLY_CORE_") && !KNOWN_KEYS.has(k) && !/_INTERVAL_MS$/.test(k),
    );
    return { home, port, logLevel, allowedOrigins, connectors: connectors.length ? connectors : DEFAULT_ENABLED_IDS, intervals, unknownKeys };
}

const KNOWN_KEYS = new Set([
    "REPLY_CORE_HOME",
    "REPLY_CORE_PORT",
    "REPLY_CORE_LOG_LEVEL",
    "REPLY_CORE_ALLOWED_ORIGINS",
    "REPLY_CORE_CONNECTORS",
]);
