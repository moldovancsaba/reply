/**
 * Reply hub preflight — structured integration checks derived from health + local paths.
 * Single source for dashboard, /api/preflight, and optional strict outbound gate.
 */

"use strict";

const crypto = require("crypto");
const fs = require("fs");

const PREFLIGHT_SCHEMA_VERSION = 1;
const API_CONTRACT_HUB = "1.0";

function isWorkerConsideredUp(status) {
    const s = String(status || "").toLowerCase();
    return s === "online" || s === "loading in queue" || s.startsWith("restarting");
}

/**
 * @param {object} health - payload from buildSystemHealthPayloadCore
 * @param {object} pathCtx - from collectPathContext()
 * @param {{ settings?: object }} [options]
 */
function buildPreflightReport(health, pathCtx, options = {}) {
    const { resolveWhatsAppSendTransport } = require("./utils/whatsapp-utils");
    const settings = options.settings || {};
    const allowOpenClaw = settings?.global?.allowOpenClaw !== false;
    const waTransport = resolveWhatsAppSendTransport(undefined);
    const needsOpenClaw = allowOpenClaw && waTransport === "openclaw_cli";

    const checks = [];
    const runId = crypto.randomUUID();

    checks.push({
        id: "hub",
        category: "core",
        title: "Reply hub",
        severity: "info",
        status: "ok",
        detail: `version ${health.version || "unknown"}`,
        hint: null
    });

    const w = health.services?.worker?.status || "unknown";
    const workerUp = isWorkerConsideredUp(w);
    checks.push({
        id: "background_worker",
        category: "core",
        title: "Background worker",
        severity: "critical",
        status: workerUp ? "ok" : "blocked",
        detail: workerUp ? "running" : `status=${w}`,
        hint: workerUp
            ? null
            : "Restart the worker from Settings or the dashboard. See chat/logs/worker.log"
    });

    const dbOk = health.db?.status === "ok";
    checks.push({
        id: "unified_data_store",
        category: "core",
        title: "Unified data store (chat.db)",
        severity: "critical",
        status: dbOk ? "ok" : "blocked",
        detail: dbOk ? "present and readable" : "missing or unreadable",
        hint: dbOk ? null : "Ensure chat/data/chat.db exists and the hub can read it (run sync once)."
    });

    if (process.platform === "darwin") {
        const ir = pathCtx.imessageDbReadable;
        checks.push({
            id: "imessage_source",
            category: "channels",
            title: "iMessage database access",
            severity: "warning",
            status: ir ? "ok" : "degraded",
            detail: ir ? pathCtx.imessageDbPath : `not readable: ${pathCtx.imessageDbPath}`,
            hint: ir
                ? null
                : "Grant Full Disk Access to the process running the hub, or set REPLY_IMESSAGE_DB_PATH in chat/.env."
        });
    }

    const wr = pathCtx.whatsappDbReadable;
    checks.push({
        id: "whatsapp_desktop_db",
        category: "channels",
        title: "WhatsApp Desktop history (ChatStorage.sqlite)",
        severity: "warning",
        status: wr ? "ok" : "degraded",
        detail: wr ? pathCtx.whatsappDbPath : `not found: ${pathCtx.whatsappDbPath || "(no path)"}`,
        hint: wr
            ? null
            : "Local history sync needs WhatsApp Desktop’s ChatStorage.sqlite or REPLY_WHATSAPP_DB_PATH. OpenClaw login does not replace this for ingestion."
    });

    const oc = health.services?.openclaw?.status || "unknown";
    const ocOnline = oc === "online";
    const ocSev = needsOpenClaw ? "critical" : "warning";
    let ocStatus = "degraded";
    if (ocOnline) ocStatus = "ok";
    else if (needsOpenClaw) ocStatus = "blocked";
    checks.push({
        id: "openclaw_gateway",
        category: "integrations",
        title: "OpenClaw gateway",
        severity: ocSev,
        status: ocStatus,
        detail: `${oc}${needsOpenClaw ? " (required for current WhatsApp send transport)" : ""}`,
        hint: ocOnline ? null : "Start the gateway (e.g. openclaw gateway) or your Docker stack; see docs/openclaw_playbook.md"
    });

    const ol = health.services?.ollama?.status || "offline";
    const olOk = ol === "online";
    checks.push({
        id: "ollama",
        category: "ai",
        title: "Ollama (local models)",
        severity: "warning",
        status: olOk ? "ok" : "degraded",
        detail: ol,
        hint: olOk ? null : "Start with: ollama serve"
    });

    const hatApi = health.services?.hatori_api || {};
    const hat = hatApi.status || "skipped";
    const hatDetail = hatApi.detail != null ? String(hatApi.detail) : String(hat);
    const hatAgents = Array.isArray(hatApi.agents) ? hatApi.agents : [];
    const agentsBad = hatAgents.filter((a) => !a.ok);
    const hatoriRequired = process.env.REPLY_USE_HATORI === "1";
    if (hatoriRequired) {
        const apiUp = hat === "online";
        const agentsOk = hatAgents.length === 0 || agentsBad.length === 0;
        const rowStatus = !apiUp ? "blocked" : !agentsOk ? "degraded" : "ok";
        const rowSeverity = !apiUp ? "critical" : !agentsOk ? "warning" : "info";
        let detail = hatDetail;
        if (apiUp && !agentsOk) {
            detail = `${hatDetail} — lanes not ok: ${agentsBad.map((b) => b.role).join(", ")}`;
        }
        checks.push({
            id: "hatori_api",
            category: "ai",
            title: "Hatori API (writer / drafter / judge)",
            severity: rowSeverity,
            status: rowStatus,
            detail,
            hint: apiUp
                ? hatApi.ui_url
                    ? `Watch & chat: ${hatApi.ui_url}`
                    : "Open Hatori UI (default http://127.0.0.1:23571/chat)."
                : process.env.REPLY_HATORI_EXTERNAL === "1"
                  ? "Check Hatori on REPLY_HATORI_PORT (default 23572), launchctl, or `make run` in REPLY_HATORI_PROJECT_PATH."
                  : "Start Hatori on its port, use launchctl, or set REPLY_HATORI_EXTERNAL=1 if it runs outside this hub."
        });
    } else {
        checks.push({
            id: "hatori_api",
            category: "ai",
            title: "Hatori API",
            severity: "info",
            status: "skipped",
            detail: "REPLY_USE_HATORI not enabled",
            hint: null
        });
    }

    const summary = { ok: 0, degraded: 0, blocked: 0, skipped: 0 };
    for (const c of checks) {
        if (summary[c.status] !== undefined) summary[c.status] += 1;
    }

    const hasBlocked = checks.some((c) => c.status === "blocked");
    const hasDegraded = checks.some((c) => c.status === "degraded");
    const overall = hasBlocked ? "blocked" : hasDegraded ? "degraded" : "ready";

    return {
        runId,
        schemaVersion: PREFLIGHT_SCHEMA_VERSION,
        at: new Date().toISOString(),
        overall,
        checks,
        summary
    };
}

function collectPathContext() {
    const { resolveIMessageDbPath } = require("./imessage-db-path.js");
    const { resolveWhatsAppChatStoragePath } = require("./utils/whatsapp-db-path.js");
    const imessageDbPath = resolveIMessageDbPath();
    const whatsappDbPath = resolveWhatsAppChatStoragePath();
    return {
        imessageDbPath,
        imessageDbReadable: fs.existsSync(imessageDbPath),
        whatsappDbPath: whatsappDbPath || "",
        whatsappDbReadable: !!(whatsappDbPath && fs.existsSync(whatsappDbPath))
    };
}

module.exports = {
    PREFLIGHT_SCHEMA_VERSION,
    API_CONTRACT_HUB,
    buildPreflightReport,
    collectPathContext
};
