/**
 * {reply} - System & Health Routes
 */

const { writeJson } = require("../utils/server-utils");
const { readSettings, isGmailConfigured, isImapConfigured } = require("../settings-store");
const { readChannelSyncState } = require("../channel-bridge");
const contactStore = require("../contact-store");
const fs = require("fs");
const path = require("path");
const http = require("http");
const hubRuntime = require("../hub-runtime");
const { ensureWorkerCanStartFromHub } = require("../ensure-hub-worker.js");

const DATA_DIR = path.join(__dirname, "..", "data");
const CHAT_DIR = path.join(__dirname, "..");
let hatoriConsecutiveFailures = 0;

function readStatus(filename) {
    const p = path.join(DATA_DIR, filename);
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
        const CHAT_DB = path.join(DATA_DIR, "chat.db");
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
    const notesMetadata = path.join(__dirname, '../../knowledge/notes-metadata.json');
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

const serviceManager = require("../service-manager");

async function serveSystemHealth(req, res) {
    const settings = readSettings();
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
    const kycStatus = readStatus("kyc_sync_status.json");

    // ── Check Hatori ────────────────────────────────────────────────────
    // Only ping when this hub is configured to use Hatori (same gate as server.js sidecar).
    // Match chat/server.js: from `chat/`, two levels up then `hatori/`.
    const hatoriProjectPath = path.join(__dirname, "..", "..", "..", "hatori");
    const hatoriFeatureEnabled =
        process.env.REPLY_USE_HATORI === "1" && fs.existsSync(hatoriProjectPath);
    const hatoriHealth = hatoriFeatureEnabled
        ? { status: "degraded", detail: "unreachable" }
        : { status: "skipped", detail: "REPLY_USE_HATORI not enabled or ../hatori missing" };

    if (hatoriFeatureEnabled) {
        try {
            const hatoriPort = process.env.REPLY_HATORI_PORT || "23572";
            const hRes = await fetch(`http://127.0.0.1:${hatoriPort}/v1/health`, {
                signal: AbortSignal.timeout(12000) // 12s — Hatori loads models on first ping
            });
            if (hRes.ok) {
                hatoriConsecutiveFailures = 0;
                hatoriHealth.status = "online";
                hatoriHealth.detail = "ok";
            } else {
                hatoriConsecutiveFailures += 1;
                hatoriHealth.status = hatoriConsecutiveFailures >= 3 ? "offline" : "degraded";
                hatoriHealth.detail = `http_${hRes.status}`;
            }
        } catch (e) {
            hatoriConsecutiveFailures += 1;
            hatoriHealth.status = hatoriConsecutiveFailures >= 3 ? "offline" : "degraded";
            hatoriHealth.detail = e?.name === "TimeoutError" ? "timeout" : "unreachable";
        }
    } else {
        hatoriConsecutiveFailures = 0;
    }

    // ── Check Ollama directly on :11434 ────────────────────────────────
    // IMPORTANT: Do NOT derive Ollama status from Hatori — Hatori may time out
    // even when Ollama is running fine. Check Ollama's own API directly.
    let ollamaStatus = "offline";
    try {
        const ollamaPort = process.env.OLLAMA_PORT || "11434";
        const oRes = await fetch(`http://127.0.0.1:${ollamaPort}/api/tags`, {
            signal: AbortSignal.timeout(3000)
        });
        if (oRes.ok) ollamaStatus = "online";
    } catch (e) {
        ollamaStatus = "offline";
    }

    // ── Hatori watchdog ─────────────────────────────────────────────────
    // After 3 consecutive Hatori failures, try to restart the managed sidecar (only if enabled).
    if (hatoriFeatureEnabled && hatoriConsecutiveFailures === 3) {
        const hatoriService = serviceManager.getStatus("hatori");
        const st = hatoriService.status;
        if (
            st !== "online" &&
            st !== "external" &&
            st !== "loading in queue" &&
            !String(st).startsWith("restarting")
        ) {
            console.warn("[Watchdog] Hatori unreachable for 3 checks — attempting auto-restart...");
            try {
                await serviceManager.restart("hatori");
            } catch (e) {
                console.error("[Watchdog] Hatori auto-restart failed:", e.message);
            }
        }
    }

    const [imessageCount, whatsappCount, mailCount, linkedinMessagesCount, linkedinPostsCount, notesCountIngested] = await Promise.all([
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
    ]);

    const services = serviceManager.getStatus();

    // Collect automated repair alerts from service manager
    const repairAlerts = serviceManager.getRepairAlerts();

    // Add Ollama as a non-managed external alert if it's offline
    if (ollamaStatus !== 'online') {
        repairAlerts.push({
            service: 'ollama',
            severity: hatoriConsecutiveFailures >= 3 ? 'critical' : 'warning',
            message: 'Ollama is not running. AI features (suggestions, KYC) will be unavailable.',
            hint: 'Open Terminal and run: ollama serve',
            logPath: null,
            attempts: 0
        });
    }

    const systemStatus = readStatus("system_status.json");

    // Simple DB check: if chat.db exists and is readable
    const dbPath = path.join(DATA_DIR, "chat.db");
    const dbExists = fs.existsSync(dbPath);
    const dbStatus = dbExists ? "ok" : "repair_required";

    // Inject OpenClaw status into services if it's not managed but found via health check
    // This allows the UI to see 'openclaw' in the services list for the "Start" button logic
    if (!services.openclaw) {
        services.openclaw = { name: "openclaw", status: "unknown" };
    }

    // External gateway (e.g. Docker): no hub-managed PID — probe via CLI so /api/health matches reality.
    if (!services.openclaw?.pid) {
        try {
            const { resolveOpenClawBinary } = require("../utils/whatsapp-utils");
            const { probeOpenClawGatewayHealth } = require("../openclaw-gateway-env.js");
            const data = await probeOpenClawGatewayHealth(resolveOpenClawBinary(), { timeoutMs: 4000 });
            services.openclaw = {
                ...services.openclaw,
                name: "openclaw",
                status: data.ok ? "online" : "offline",
                detail: data.ok ? "gateway health ok" : "gateway health not ok"
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
            hatori_api: { status: hatoriHealth.status, detail: hatoriHealth.detail },
            ollama: { status: ollamaStatus }
        },
        channels: {
            imessage: { ...imessageStatus, processed: imessageCount, total: imessageCount },
            whatsapp: { ...whatsappStatus, processed: whatsappCount, total: whatsappCount },
            notes: { ...notesStatus, processed: notesCountIngested, total: getNotesCount() },
            mail: {
                ...mailStatus,
                lastAt: mailStatus.lastSync || null,
                provider: mailProvider,
                account: mailAccount,
                connected: !!(gmailOk || imapOk),
                processed: mailCount,
                total: mailCount,
                status: (mailStatus.state === 'error' || (!!(gmailOk || imapOk) && mailCount === 0 && mailStatus.state === 'idle')) ? "repair_required" : (mailStatus.state || "ok")
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
            contacts: readStatus("sync_state.json"),
            kyc: kycStatus
        },
        stats: await contactStore.getStats(),
        lastCheck: new Date().toISOString(),
        httpPort,
        httpHost
    };

    writeJson(res, 200, health);
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
            await serviceManager.restart(name);
        } else if (action === "stop") {
            await serviceManager.stop(name);
        } else if (action === "start") {
            const { resolveOpenClawBinary } = require("../utils/whatsapp-utils");
            let script = null;
            let args = [];

            if (name === "worker") {
                ensureWorkerCanStartFromHub(CHAT_DIR);
                script = path.join(__dirname, "..", "background-worker.js");
            } else if (name === 'openclaw') {
                script = resolveOpenClawBinary();
                args = ['gateway'];
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
            : serviceManager.getStatus(name);
        writeJson(res, 200, { status: "ok", service: svcStatus });
    } catch (e) {
        console.error("[SystemControl Error]", e);
        writeJson(res, 500, { error: e.message });
    }
}

async function serveOpenClawStatus(req, res) {
    const { resolveOpenClawBinary } = require("../utils/whatsapp-utils");
    const { probeOpenClawGatewayHealth } = require("../openclaw-gateway-env.js");

    try {
        const data = await probeOpenClawGatewayHealth(resolveOpenClawBinary());
        writeJson(res, 200, {
            status: data.ok ? "online" : "offline",
            ...data
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

async function serveTriageLog(req, res) {
    try {
        const triageEngine = require('../triage-engine.js');
        const logs = triageEngine.getLogs(20);
        writeJson(res, 200, { logs });
    } catch (e) {
        console.error("[TriageLog Error]", e);
        writeJson(res, 500, { error: e.message });
    }
}

module.exports = {
    serveSystemHealth,
    serveServiceControl,
    serveOpenClawStatus,
    serveTriageLog
};
