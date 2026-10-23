import pino from "pino";

// Message text and personal identifiers must never reach logs.
const SENSITIVE = ["text", "body", "handle", "email", "phone", "displayName"]; // channel-literal-ok: log field names, not channel ids
const redactPaths = [
    ...SENSITIVE,
    ...SENSITIVE.map((k) => `*.${k}`),
    ...SENSITIVE.map((k) => `*.*.${k}`),
    "req.headers.authorization",
    "req.headers.cookie",
];

export function createLogger(config, destination) {
    return pino(
        { level: config.logLevel, redact: { paths: redactPaths, censor: "[redacted]" } },
        destination,
    );
}
