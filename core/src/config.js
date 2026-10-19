import os from "node:os";
import path from "node:path";

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

    const home = env.REPLY_CORE_HOME ? path.resolve(env.REPLY_CORE_HOME) : defaultHome();
    const unknownKeys = Object.keys(env).filter(
        (k) => k.startsWith("REPLY_CORE_") && !KNOWN_KEYS.has(k),
    );
    return { home, port, logLevel, allowedOrigins, unknownKeys };
}

const KNOWN_KEYS = new Set([
    "REPLY_CORE_HOME",
    "REPLY_CORE_PORT",
    "REPLY_CORE_LOG_LEVEL",
    "REPLY_CORE_ALLOWED_ORIGINS",
]);
