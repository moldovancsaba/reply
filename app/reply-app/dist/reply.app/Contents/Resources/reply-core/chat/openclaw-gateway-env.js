/**
 * Optional env overrides so the OpenClaw CLI talks to a non-default gateway
 * (e.g. Docker on ws://127.0.0.1:18790). See REPLY_OPENCLAW_GATEWAY_* in .env.example.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);

function getOpenClawGatewayProcessEnv() {
    const out = {};
    const url = String(process.env.REPLY_OPENCLAW_GATEWAY_URL || "").trim();
    if (url) {
        out.OPENCLAW_GATEWAY_URL = url;
    }
    const token = String(process.env.REPLY_OPENCLAW_GATEWAY_TOKEN || "").trim();
    if (url && token) {
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

function wsGatewayUrlToHealthzHttpUrl(wsBase) {
    const u = new URL(wsBase);
    if (u.protocol !== "ws:" && u.protocol !== "wss:") {
        return null;
    }
    const scheme = u.protocol === "wss:" ? "https:" : "http:";
    return `${scheme}//${u.host}/healthz`;
}

/**
 * Prefer HTTP `/healthz` when `REPLY_OPENCLAW_GATEWAY_URL` is ws(s):// — Docker gateways answer here
 * without WS pairing; the OpenClaw CLI `gateway health` can return `pairing required` (1008) even
 * when the gateway is live.
 */
async function probeOpenClawGatewayHealthzFromEnv(timeoutMs) {
    const wsBase = String(process.env.REPLY_OPENCLAW_GATEWAY_URL || "").trim();
    const candidates = [];
    if (wsBase && (wsBase.startsWith("ws:") || wsBase.startsWith("wss:"))) {
        try {
            const mapped = wsGatewayUrlToHealthzHttpUrl(wsBase);
            if (mapped) candidates.push(mapped);
        } catch {
            /* ignore malformed ws base and fall back to local defaults */
        }
    }

    const localPort = Number(
        process.env.REPLY_OPENCLAW_GATEWAY_PORT ||
        process.env.OPENCLAW_GATEWAY_PORT ||
        18790
    );
    if (Number.isFinite(localPort) && localPort > 0) {
        candidates.push(`http://127.0.0.1:${localPort}/healthz`);
        candidates.push(`http://[::1]:${localPort}/healthz`);
    }

    const ms = timeoutMs ?? 4000;
    for (const healthUrl of candidates) {
        const ac = new AbortController();
        const id = setTimeout(() => ac.abort(), ms);
        try {
            const r = await fetch(healthUrl, { signal: ac.signal });
            if (!r.ok) {
                throw new Error(`healthz HTTP ${r.status}`);
            }
            return await r.json();
        } catch {
            /* try next candidate */
        } finally {
            clearTimeout(id);
        }
    }
    /* Let CLI fallback run when healthz is down */
    return null;
}

/**
 * Normalize gateway probe payloads: Docker `/healthz` often returns `{ ok, status: "live" }`;
 * some builds omit `ok` and only set `status`.
 * @param {unknown} data
 * @returns {boolean}
 */
function openclawGatewayResponseOk(data) {
    if (!data || typeof data !== "object") return false;
    if (data.ok === true) return true;
    const s = String(data.status || "").toLowerCase();
    return s === "live" || s === "ok";
}

/**
 * Gateway liveness: try `/healthz` when a ws(s) `REPLY_OPENCLAW_GATEWAY_URL` is set, else `openclaw gateway health --json`.
 * @param {string} bin Absolute path or name of the openclaw executable
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<Record<string, unknown>>}
 */
async function probeOpenClawGatewayHealth(bin, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 5000;
    const viaHttp = await probeOpenClawGatewayHealthzFromEnv(timeoutMs);
    if (viaHttp) {
        return { ...viaHttp, ok: openclawGatewayResponseOk(viaHttp) };
    }

    const childEnv = getOpenClawGatewayExecEnv();
    const args = ["gateway", "health", "--json"];
    try {
        const { stdout } = await execFileAsync(bin, args, { timeout: timeoutMs, env: childEnv });
        const jsonStart = stdout.indexOf("{");
        if (jsonStart === -1) {
            throw new Error("No JSON object found in gateway health output");
        }
        const parsed = JSON.parse(stdout.slice(jsonStart));
        return { ...parsed, ok: openclawGatewayResponseOk(parsed) };
    } catch (error) {
        const { stdout } = await execFileAsync(bin, ["channels", "status", "--json"], {
            timeout: timeoutMs,
            env: childEnv
        });
        const jsonStart = stdout.indexOf("{");
        if (jsonStart === -1) {
            throw error;
        }
        const parsed = JSON.parse(stdout.slice(jsonStart));
        return {
            ...parsed,
            ok: true,
            status: "live",
            probe: "channels_status_fallback"
        };
    }
}

module.exports = {
    getOpenClawGatewayProcessEnv,
    getOpenClawGatewayExecEnv,
    readGatewayTokenFromHomeConfig,
    probeOpenClawGatewayHealth,
    probeOpenClawGatewayHealthzFromEnv,
    wsGatewayUrlToHealthzHttpUrl,
    openclawGatewayResponseOk
};
