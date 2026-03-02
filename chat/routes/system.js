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

const DATA_DIR = path.join(__dirname, "..", "data");

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
            db.serialize(() => {
                db.run("PRAGMA journal_mode = WAL");
                db.run("PRAGMA busy_timeout = 5000");
                let query = "";
                if (source === "iMessage") {
                    query = "SELECT count(*) as count FROM message WHERE text IS NOT NULL AND text != ''";
                } else {
                    query = "SELECT count(*) as count FROM unified_messages WHERE source = ?";
                }
                db.get(query, source === "iMessage" ? [] : [source], (err, row) => {
                    db.close();
                    resolve(row?.count || 0);
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

    // Check Hatori/Ollama
    let hatoriHealth = { status: "offline", ollama: "offline" };
    try {
        const hatoriPort = process.env.REPLY_HATORI_PORT || "23572";
        const hRes = await fetch(`http://127.0.0.1:${hatoriPort}/v1/health`, { signal: AbortSignal.timeout(2000) });
        if (hRes.ok) {
            const hData = await hRes.json();
            hatoriHealth.status = "online";
            hatoriHealth.ollama = hData.runtime_status?.ollama?.ok ? "online" : "offline";
        }
    } catch (e) { /* ignore */ }

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

    const systemStatus = readStatus("system_status.json");

    // Simple DB check: if chat.db exists and is readable
    const dbPath = path.join(DATA_DIR, "chat.db");
    const dbExists = fs.existsSync(dbPath);
    let dbStatus = dbExists ? "ok" : "repair_required";

    // Inject OpenClaw status into services if it's not managed but found via health check
    // This allows the UI to see 'openclaw' in the services list for the "Start" button logic
    if (!services.openclaw) {
        services.openclaw = { name: "openclaw", status: "unknown" };
    }

    const health = {
        uptime: Math.floor(process.uptime()),
        status: systemStatus.status || "online",
        progress: systemStatus.progress || 100,
        db: { status: dbStatus },
        services: {
            ...services,
            hatori_api: { status: hatoriHealth.status },
            ollama: { status: hatoriHealth.ollama }
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
        lastCheck: new Date().toISOString()
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
            await serviceManager.restart(name);
        } else if (action === "stop") {
            await serviceManager.stop(name);
        } else if (action === "start") {
            const { resolveOpenClawBinary } = require("../utils/whatsapp-utils");
            let script = null;
            let args = [];

            if (name === 'worker') {
                script = path.join(__dirname, '..', 'background-worker.js');
            } else if (name === 'openclaw') {
                script = resolveOpenClawBinary();
                args = ['gateway'];
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

        writeJson(res, 200, { status: "ok", service: serviceManager.getStatus(name) });
    } catch (e) {
        console.error("[SystemControl Error]", e);
        writeJson(res, 500, { error: e.message });
    }
}

async function serveOpenClawStatus(req, res) {
    const { execFile } = require("child_process");
    const { resolveOpenClawBinary } = require("../utils/whatsapp-utils");
    const os = require("os");

    // Read the gateway auth token from the OpenClaw config
    let gatewayToken = null;
    try {
        const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
        if (fs.existsSync(configPath)) {
            const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
            gatewayToken = cfg?.gateway?.auth?.token || null;
        }
    } catch (e) {
        // Ignore — health check will fail gracefully
    }

    const bin = resolveOpenClawBinary();
    const args = ["gateway", "health", "--json"];
    if (gatewayToken) args.push("--token", gatewayToken);

    execFile(bin, args, { timeout: 5000 }, (error, stdout, stderr) => {
        if (error) {
            console.error("OpenClaw CLI health check failed:", error.message);
            writeJson(res, 200, {
                status: "offline",
                error: "OpenClaw health check failed",
                detail: error.message
            });
            return;
        }

        try {
            // Robust parsing: find the first '{' to skip any banners (like lobster)
            const jsonStart = stdout.indexOf('{');
            if (jsonStart === -1) throw new Error("No JSON object found in output");
            const data = JSON.parse(stdout.slice(jsonStart));

            writeJson(res, 200, {
                status: data.ok ? "online" : "offline",
                ...data
            });
        } catch (e) {
            console.error("Failed to parse OpenClaw health JSON:", e.message);
            writeJson(res, 200, {
                status: "offline",
                error: "Invalid JSON from OpenClaw CLI",
                stdout_preview: stdout.slice(0, 200),
                detail: e.message
            });
        }
    });
}

module.exports = {
    serveSystemHealth,
    serveOpenClawStatus
};
