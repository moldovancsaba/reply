/**
 * Optional env overrides so the OpenClaw CLI talks to a non-default gateway
 * (e.g. Docker on ws://127.0.0.1:18790). See REPLY_OPENCLAW_GATEWAY_* in .env.example.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

function getOpenClawGatewayProcessEnv() {
    const out = {};
    const url = String(process.env.REPLY_OPENCLAW_GATEWAY_URL || "").trim();
    if (url) {
        out.OPENCLAW_GATEWAY_URL = url;
    }
    const token = String(process.env.REPLY_OPENCLAW_GATEWAY_TOKEN || "").trim();
    if (token) {
        out.OPENCLAW_GATEWAY_TOKEN = token;
    }
    return out;
}

function readGatewayTokenFromHomeConfig() {
    try {
        const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
        if (!fs.existsSync(configPath)) return null;
        const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
        return cfg?.gateway?.auth?.token || null;
    } catch {
        return null;
    }
}

/**
 * `env` for child_process when invoking the OpenClaw CLI.
 * When REPLY_OPENCLAW_GATEWAY_URL is set, OPENCLAW_GATEWAY_TOKEN is required for WS;
 * we fill it from REPLY_OPENCLAW_GATEWAY_TOKEN or ~/.openclaw/openclaw.json when missing.
 */
function getOpenClawGatewayExecEnv() {
    const out = { ...process.env, ...getOpenClawGatewayProcessEnv() };
    if (out.OPENCLAW_GATEWAY_URL && !out.OPENCLAW_GATEWAY_TOKEN) {
        const t =
            String(process.env.REPLY_OPENCLAW_GATEWAY_TOKEN || "").trim() ||
            readGatewayTokenFromHomeConfig();
        if (t) {
            out.OPENCLAW_GATEWAY_TOKEN = t;
        }
    }
    return out;
}

module.exports = {
    getOpenClawGatewayProcessEnv,
    getOpenClawGatewayExecEnv,
    readGatewayTokenFromHomeConfig
};
