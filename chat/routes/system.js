/**
 * {reply} - System & Health Routes
 */

const { writeJson } = require("../utils/server-utils");
const { readSettings, isGmailConfigured, isImapConfigured } = require("../settings-store");
const { readChannelSyncState } = require("../channel-bridge");
const contactStore = require("../contact-store");
const fs = require("fs");
const path = require("path");
const hubRuntime = require("../hub-runtime");
const { ensureWorkerCanStartFromHub } = require("../ensure-hub-worker.js");
const { resolveOllamaHttpBase } = require("../ai-runtime-config.js");
const { execFile } = require("child_process");
const { getDataHome, dataPath } = require("../app-paths.js");

const DATA_DIR = getDataHome();
const CHAT_DIR = path.join(__dirname, "..");

function readStatus(filename) {
    const p = dataPath(filename);
    if (fs.existsSync(p)) {
        try {
            return JSON.parse(fs.readFileSync(p, "utf8"));
        } catch (e) {
            return { state: "error", message: e.message };
        }
    }
    return { state: "idle", message: "No sync data available" };
}

async function countIngested(source) {
    try {
        const sqlite3 = require("sqlite3");
        const CHAT_DB = dataPath("chat.db");
        if (!fs.existsSync(CHAT_DB)) return 0;

        const db = new sqlite3.Database(CHAT_DB);
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
                if (settled) return;
                settled = true;
                try {
                    db.close();
                } catch {
                    /* ignore */
                }
                resolve(value);
            };
            db.on("error", (err) => {
                console.error(`[system/health] unified chat.db SQLite error (${source} count):`, err.message);
                finish(0);
            });
            db.serialize(() => {
                db.run("PRAGMA journal_mode = WAL");
                db.run("PRAGMA busy_timeout = 5000");
                // Local data/chat.db holds unified_messages from sync, not necessarily Apple’s message schema
                const query = "SELECT count(*) as count FROM unified_messages WHERE source = ?";
                db.get(query, [source], (err, row) => {
                    if (err) {
                        console.error(`Error counting ${source}:`, err);
                        finish(0);
                        return;
                    }
                    finish(row?.count || 0);
                });
            });
        });
    } catch (e) {
        console.error(`Error counting ${source}:`, e);
        return 0;
    }
}

function getNotesCount() {
    const notesMetadata = dataPath("notes-metadata.json");
    if (fs.existsSync(notesMetadata)) {
        try {
            const data = JSON.parse(fs.readFileSync(notesMetadata, "utf8"));
            return Object.keys(data).length;
        } catch (e) {
            return 0;
        }
    }
    return 0;
}

function getIMessageCheckpointLastSync() {
    const checkpointPath = dataPath("sync_state.json");
    if (!fs.existsSync(checkpointPath)) return null;
    try {
        const state = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
        return state?.lastSync || null;
    } catch {
        return null;
    }
}

function execFileAsync(command, args, opts = {}) {
    return new Promise((resolve, reject) => {
        execFile(command, args, opts, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                return reject(error);
            }
            resolve({ stdout, stderr });
        });
    });
}

async function controlOpenClawGateway(action) {
    const { resolveOpenClawBinary } = require("../utils/whatsapp-utils");
    const { getOpenClawGatewayExecEnv } = require("../openclaw-gateway-env.js");
    const bin = resolveOpenClawBinary();
    const env = getOpenClawGatewayExecEnv();

    if (action === "start") {
        try {
            await execFileAsync(bin, ["gateway", "status"], { env, timeout: 8000 });
        } catch (error) {
            const combined = `${error.stdout || ""}\n${error.stderr || ""}\n${error.message || ""}`;
            if (/not installed|unit not found|not loaded/i.test(combined)) {
                await execFileAsync(bin, ["gateway", "install"], { env, timeout: 30000 });
            }
        }
        await execFileAsync(bin, ["gateway", "start"], { env, timeout: 30000 });
        return;
    }

    if (action === "restart") {
        try {
            await execFileAsync(bin, ["gateway", "restart"], { env, timeout: 30000 });
        } catch (error) {
            const combined = `${error.stdout || ""}\n${error.stderr || ""}\n${error.message || ""}`;
            if (/not installed|unit not found|not loaded/i.test(combined)) {
                await execFileAsync(bin, ["gateway", "install"], { env, timeout: 30000 });
                await execFileAsync(bin, ["gateway", "start"], { env, timeout: 30000 });
                return;
            }
            throw error;
        }
        return;
    }

    if (action === "stop") {
        await execFileAsync(bin, ["gateway", "stop"], { env, timeout: 30000 });
    }
}

function normalizeChannelStatus(baseStatus, ingestedTotal, extras = {}) {
    const state = String(baseStatus?.state || baseStatus?.status || "idle").toLowerCase();
    const lastSuccessfulSync = baseStatus?.lastSuccessfulSync || baseStatus?.lastSync || null;
    const lastAttemptedSync = baseStatus?.lastAttemptedSync || baseStatus?.timestamp || lastSuccessfulSync || null;
    const numeric = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    const processed = Math.max(numeric(baseStatus?.processed), numeric(ingestedTotal));
    const total = Math.max(numeric(baseStatus?.total), numeric(ingestedTotal));
    return {
        ...baseStatus,
        state,
        status: state === "error" ? "repair_required" : (state || "idle"),
        ingestedTotal,
        processed,
        total,
        lastSuccessfulSync,
        lastAttemptedSync,
        ...extras
    };
}

const serviceManager = require("../service-manager");
const { buildPreflightReport, collectPathContext, API_CONTRACT_HUB, PREFLIGHT_SCHEMA_VERSION } = require("../preflight.js");

/** Updated on each full health build; used by strict outbound gate. */
let lastPreflightReport = null;
let lastPreflightAtMs = 0;

async function buildSystemHealthPayloadCore() {
    const numeric = (value) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    };
    const settings = readSettings();
    const healthCfg = settings?.health || {};
    const ollamaProbeMs = Math.max(
        1000,
        Math.min(parseInt(healthCfg.ollamaProbeTimeoutMs, 10) || 3000, 30000)
    );
    const mailStatus = readStatus("mail_sync_status.json");
    const gmailOk = isGmailConfigured(settings);
    const imapOk = isImapConfigured(settings);
    const mailProvider = gmailOk ? "gmail" : (imapOk ? "imap" : (mailStatus.connector || ""));
    const mailAccount =
        (gmailOk ? (settings?.gmail?.email || "") : "") ||
        (imapOk ? (settings?.imap?.user || "") : "") ||
        (process.env.REPLY_IMAP_USER || "");

    const imessageStatus = readStatus("imessage_sync_status.json");
    const whatsappStatus = readStatus("whatsapp_sync_status.json");
    const notesStatus = readStatus("notes_sync_status.json");
    const calendarStatus = readStatus("calendar_sync_status.json");
    const kycStatus = readStatus("kyc_sync_status.json");

    // ── Check Ollama directly (OLLAMA_HOST / port from env or Settings) ─
    // Check Ollama's own API directly instead of inferring availability from another service.
    let ollamaStatus = "offline";
    try {
        const oRes = await fetch(`${resolveOllamaHttpBase()}/api/tags`, {
            signal: AbortSignal.timeout(ollamaProbeMs)
        });
        if (oRes.ok) ollamaStatus = "online";
    } catch (e) {
        ollamaStatus = "offline";
    }

    const [imessageCount, whatsappCount, mailCount, linkedinMessagesCount, linkedinPostsCount, notesCountIngested, calendarCount] = await Promise.all([
        countIngested("iMessage"),
        countIngested("WhatsApp"),
        (async () => {
            try {
                const { connect } = require("../vector-store.js");
                const db = await connect();
                const table = await db.openTable("documents");
                return await table.countRows("source IN ('Gmail','IMAP','Mail','mbox')");
            } catch { return 0; }
        })(),
        (async () => {
            try {
                const { connect } = require("../vector-store.js");
                const db = await connect();
                const table = await db.openTable("documents");
                return await table.countRows("source IN ('LinkedIn')");
            } catch { return 0; }
        })(),
        (async () => {
            try {
                const { connect } = require("../vector-store.js");
                const db = await connect();
                const table = await db.openTable("documents");
                return await table.countRows("source IN ('linkedin-posts')");
            } catch { return 0; }
        })(),
        (async () => {
            try {
                const { connect } = require("../vector-store.js");
                const db = await connect();
                const table = await db.openTable("documents");
                return await table.countRows("source IN ('apple-notes')");
            } catch { return 0; }
        })(),
        countIngested("apple-calendar"),
    ]);

    const services = serviceManager.getStatus();

    // Collect automated repair alerts from service manager
    const repairAlerts = serviceManager.getRepairAlerts();

    // Add Ollama as a non-managed external alert if it's offline
    if (ollamaStatus !== 'online') {
        repairAlerts.push({
            service: 'ollama',
            severity: 'warning',
            message: 'Ollama is not running. AI features (suggestions, KYC) will be unavailable.',
            hint: 'Open Terminal and run: ollama serve',
            logPath: null,
            attempts: 0
        });
    }

    const systemStatus = readStatus("system_status.json");

    // Simple DB check: if chat.db exists and is readable
    const dbPath = dataPath("chat.db");
    const dbExists = fs.existsSync(dbPath);
    const dbStatus = dbExists ? "ok" : "repair_required";

    // Inject OpenClaw status into services if it's not managed but found via health check
    // This allows the UI to see 'openclaw' in the services list for the "Start" button logic
    if (!services.openclaw) {
        services.openclaw = { name: "openclaw", status: "unknown" };
    }

    // Gateway liveness: when `REPLY_OPENCLAW_GATEWAY_URL` is ws(s)://, always prefer HTTP `/healthz`
    // (Docker) — even if the hub once spawned a local `openclaw` child (stale pid). CLI fallback uses
    // ~/.openclaw token and can falsely report "offline" / token mismatch while Docker is live.
    const openclawWsConfigured = /^wss?:\/\//i.test(String(process.env.REPLY_OPENCLAW_GATEWAY_URL || "").trim());
    if (!services.openclaw?.pid || openclawWsConfigured) {
        try {
            const { resolveOpenClawBinary } = require("../utils/whatsapp-utils");
            const { probeOpenClawGatewayHealth, openclawGatewayResponseOk } = require("../openclaw-gateway-env.js");
            const data = await probeOpenClawGatewayHealth(resolveOpenClawBinary(), { timeoutMs: 4000 });
            const ocOk = openclawGatewayResponseOk(data);
            services.openclaw = {
                ...services.openclaw,
                name: "openclaw",
                status: ocOk ? "online" : "offline",
                detail: ocOk ? "gateway health ok" : "gateway health not ok"
            };
        } catch (e) {
            services.openclaw = {
                ...services.openclaw,
                name: "openclaw",
                status: "offline",
                lastError: e.message
            };
        }
    }

    let replyVersion = "unknown";
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
        replyVersion = pkg.version;
    } catch (e) { }

    // Bound listen address (reply#31): see `hub-runtime.js`; null until server.listen() runs.
    const { httpPort, httpHost } = hubRuntime.getListenInfo();

    const health = {
        ok: true,
        version: replyVersion,
        statusMessage: systemStatus.status || "online",
        uptime: Math.floor(process.uptime()),
        status: systemStatus.status || "online",
        progress: systemStatus.progress || 100,
        db: { status: dbStatus },
        repair: repairAlerts,
        services: {
            ...services,
            ollama: { status: ollamaStatus }
        },
        channels: {
            imessage: normalizeChannelStatus(imessageStatus, imessageCount, {
                lastSuccessfulSync: imessageStatus?.lastSuccessfulSync || imessageStatus?.lastSync || getIMessageCheckpointLastSync()
            }),
            whatsapp: normalizeChannelStatus(whatsappStatus, whatsappCount),
            notes: normalizeChannelStatus(notesStatus, notesCountIngested, {
                total: Math.max(numeric(notesStatus.total), numeric(notesStatus.processed), numeric(notesStatus.updated), numeric(getNotesCount()), numeric(notesCountIngested))
            }),
            calendar: normalizeChannelStatus(calendarStatus, calendarCount),
            mail: {
                ...mailStatus,
                lastAt: mailStatus.lastSync || null,
                provider: mailProvider,
                account: mailAccount,
                connected: !!(gmailOk || imapOk),
                processed: Math.max(numeric(mailStatus.processed), numeric(mailStatus.total), numeric(mailCount)),
                total: Math.max(numeric(mailStatus.total), numeric(mailStatus.processed), numeric(mailCount)),
                status: (mailStatus.state === 'error') ? "repair_required" : (mailStatus.state || "ok")
            },
            linkedin_messages: {
                ...readStatus("linkedin_sync_status.json"),
                processed: linkedinMessagesCount,
                total: linkedinMessagesCount,
                lastAt: readChannelSyncState().linkedin || null
            },
            linkedin_posts: {
                ...readStatus("linkedin_posts_sync_status.json"),
                processed: linkedinPostsCount,
                total: linkedinPostsCount,
                lastAt: readChannelSyncState().linkedin_posts || null
            },
            contacts: readStatus("contacts_sync_status.json"),
            kyc: kycStatus
        },
        stats: await contactStore.getStats(),
        lastCheck: new Date().toISOString(),
        httpPort,
        httpHost
    };

    return health;
}

function attachPreflightToHealth(health) {
    const settings = readSettings();
    const pathCtx = collectPathContext();
    const preflight = buildPreflightReport(health, pathCtx, { settings });
    health.apiContract = { hub: API_CONTRACT_HUB, preflightSchema: PREFLIGHT_SCHEMA_VERSION };
    health.preflight = preflight;
    lastPreflightReport = preflight;
    lastPreflightAtMs = Date.now();
    return health;
}

async function buildSystemHealthPayload() {
    const health = await buildSystemHealthPayloadCore();
    return attachPreflightToHealth(health);
}

async function serveSystemHealth(req, res) {
    writeJson(res, 200, await buildSystemHealthPayload());
}

/**
 * Standalone preflight JSON for scripts or clients that only need foundation checks.
 */
async function servePreflight(req, res) {
    const health = await buildSystemHealthPayload();
    const p = health.preflight || {};
    writeJson(res, 200, {
        ok: p.overall !== "blocked",
        version: health.version,
        apiContract: health.apiContract,
        runId: p.runId,
        schemaVersion: p.schemaVersion,
        at: p.at,
        overall: p.overall,
        checks: p.checks,
        summary: p.summary
    });
}

/**
 * Outbound sends are not gated on hub preflight (Foundation matrix stays informational on the dashboard).
 * Returns null always so all channels can send while operators fix worker/db/etc. separately.
 */
async function maybeBlockOutboundOnPreflight() {
    return null;
}

async function serveServiceControl(req, res) {
    try {
        const { readJsonBody } = require("../utils/server-utils");
        const { name, action } = await readJsonBody(req);

        if (!name || !action) {
            writeJson(res, 400, { error: "Missing name or action" });
            return;
        }

        console.log(`[SystemControl] Service: ${name}, Action: ${action}`);

        if (action === "restart") {
            if (name === "worker") {
                ensureWorkerCanStartFromHub(CHAT_DIR);
            }
            if (name === "openclaw") {
                await controlOpenClawGateway("restart");
            } else {
                await serviceManager.restart(name);
            }
        } else if (action === "stop") {
            if (name === "openclaw") {
                await controlOpenClawGateway("stop");
            } else {
                await serviceManager.stop(name);
            }
        } else if (action === "start") {
            const { resolveOpenClawBinary } = require("../utils/whatsapp-utils");
            let script = null;
            let args = [];

            if (name === "worker") {
                ensureWorkerCanStartFromHub(CHAT_DIR);
                script = path.join(__dirname, "..", "background-worker.js");
            } else if (name === 'openclaw') {
                await controlOpenClawGateway("start");
            } else if (name === 'ollama') {
                // Ollama is an external binary — find it and spawn 'ollama serve'
                // Common install locations on macOS
                const ollamaPaths = [
                    '/usr/local/bin/ollama',
                    '/opt/homebrew/bin/ollama',
                    process.env.OLLAMA_BIN || ''
                ].filter(Boolean);
                script = ollamaPaths.find(p => fs.existsSync(p)) || 'ollama';
                args = ['serve'];
            }

            if (!script) {
                if (name === 'openclaw') {
                    writeJson(res, 200, { status: "ok", service: { name: "openclaw", status: "starting" } });
                    return;
                }
                writeJson(res, 400, { error: `Unknown service or missing configuration for ${name}` });
                return;
            }
            serviceManager.start(name, script, args);
        } else {
            writeJson(res, 400, { error: "Invalid action" });
            return;
        }

        // For ollama, we can't query serviceManager directly (external binary)
        // Return a synthesized status
        const svcStatus = name === 'ollama'
            ? { name: 'ollama', status: 'starting' }
            : name === 'openclaw'
                ? { name: 'openclaw', status: action === 'stop' ? 'stopping' : 'starting' }
            : serviceManager.getStatus(name);
        writeJson(res, 200, { status: "ok", service: svcStatus });
    } catch (e) {
        console.error("[SystemControl Error]", e);
        writeJson(res, 500, { error: e.message });
    }
}

async function serveOpenClawStatus(req, res) {
    const { resolveOpenClawBinary } = require("../utils/whatsapp-utils");
    const { probeOpenClawGatewayHealth, openclawGatewayResponseOk } = require("../openclaw-gateway-env.js");

    try {
        const data = await probeOpenClawGatewayHealth(resolveOpenClawBinary());
        const ok = openclawGatewayResponseOk(data);
        const whatsappStatus = readStatus("whatsapp_sync_status.json");
        const fallbackChannels = ok ? ["whatsapp"] : [];
        const heartbeat =
            whatsappStatus?.lastAttemptedSync ||
            whatsappStatus?.lastSuccessfulSync ||
            whatsappStatus?.lastSync ||
            whatsappStatus?.timestamp ||
            null;
        writeJson(res, 200, {
            status: ok ? "online" : "offline",
            ...data,
            channels: data?.channels || fallbackChannels,
            heartbeat,
            ok
        });
    } catch (error) {
        console.error("OpenClaw CLI health check failed:", error.message);
        writeJson(res, 200, {
            status: "offline",
            error: "OpenClaw health check failed",
            detail: error.message
        });
    }
}

async function serveTriageLog(req, res, url) {
    try {
        const triageEngine = require('../triage-engine.js');
        const n = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 20, 200));
        const logs = triageEngine.getLogs(n);
        writeJson(res, 200, { logs });
    } catch (e) {
        console.error("[TriageLog Error]", e);
        writeJson(res, 500, { error: e.message });
    }
}

/** Deduped high-priority triage rows for zero-inbox UI (reply#24). */
async function serveTriageQueue(req, res, url) {
    try {
        const triageEngine = require('../triage-engine.js');
        const n = Math.max(1, Math.min(Number(url.searchParams.get("limit")) || 15, 100));
        const queue = triageEngine.getPriorityQueue(n);
        writeJson(res, 200, { queue });
    } catch (e) {
        console.error("[TriageQueue Error]", e);
        writeJson(res, 500, { error: e.message });
    }
}

module.exports = {
    serveSystemHealth,
    servePreflight,
    buildSystemHealthPayload,
    buildSystemHealthPayloadCore,
    attachPreflightToHealth,
    maybeBlockOutboundOnPreflight,
    serveServiceControl,
    serveOpenClawStatus,
    serveTriageLog,
    serveTriageQueue
};
