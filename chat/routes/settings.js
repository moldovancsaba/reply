/**
 * {reply} - Settings Routes
 * Handles application configuration and Gmail connectivity.
 */

const { writeJson, readJsonBody } = require("../utils/server-utils");
const {
    readSettings,
    writeSettings,
    maskSettingsForClient,
    withDefaults,
    CHANNEL_BRIDGE_CHANNELS
} = require("../settings-store");
const { buildAuthUrl, connectGmailFromCallback, disconnectGmail, checkGmailConnection } = require("../gmail-connector");
const crypto = require("crypto");

let gmailOauthState = null;

function serveSettings(req, res) {
    if (req.method === "GET") {
        const settings = readSettings();
        writeJson(res, 200, maskSettingsForClient(settings));
        return;
    }

    if (req.method === "POST") {
        handleUpdateSettings(req, res);
        return;
    }

    writeJson(res, 405, { error: "Method not allowed" });
}

async function handleUpdateSettings(req, res) {
    try {
        const incoming = await readJsonBody(req);
        const current = withDefaults(readSettings());
        const next = { ...current };

        // IMAP
        const imap = incoming?.imap || {};
        if (imap && typeof imap === "object") {
            next.imap = { ...(current.imap || {}) };
            if (typeof imap.host === "string") next.imap.host = imap.host.trim();
            if (imap.port !== undefined) next.imap.port = parseInt(imap.port, 10) || 993;
            if (imap.secure !== undefined) next.imap.secure = !!imap.secure;
            if (typeof imap.user === "string") next.imap.user = imap.user.trim();
            if (typeof imap.mailbox === "string") next.imap.mailbox = imap.mailbox.trim() || "INBOX";
            if (typeof imap.sentMailbox === "string") next.imap.sentMailbox = imap.sentMailbox.trim();
            if (imap.limit !== undefined) next.imap.limit = Math.max(1, Math.min(parseInt(imap.limit, 10) || 200, 2000));
            if (imap.sinceDays !== undefined) next.imap.sinceDays = Math.max(1, Math.min(parseInt(imap.sinceDays, 10) || 30, 3650));
            if (typeof imap.selfEmails === "string") next.imap.selfEmails = imap.selfEmails.trim();
            if (typeof imap.pass === "string" && imap.pass.trim()) next.imap.pass = imap.pass;
        }

        // Gmail
        const gmail = incoming?.gmail || {};
        if (gmail && typeof gmail === "object") {
            next.gmail = { ...(current.gmail || {}) };
            if (typeof gmail.clientId === "string") next.gmail.clientId = gmail.clientId.trim();
            if (typeof gmail.redirectUri === "string") next.gmail.redirectUri = gmail.redirectUri.trim();
            if (typeof gmail.clientSecret === "string" && gmail.clientSecret.trim()) next.gmail.clientSecret = gmail.clientSecret;
            const sync = gmail.sync || {};
            if (sync && typeof sync === "object") {
                next.gmail.sync = { ...(current.gmail?.sync || {}) };
                if (typeof sync.scope === "string" && ["inbox_sent", "all_mail", "custom"].includes(sync.scope.trim())) next.gmail.sync.scope = sync.scope.trim();
                if (typeof sync.query === "string") next.gmail.sync.query = sync.query.trim().slice(0, 500);
            }
        }

        // Global
        const global = incoming?.global || {};
        if (global && typeof global === "object") {
            next.global = { ...(current.global || {}) };
            if (typeof global.googleApiKey === "string" && global.googleApiKey.trim()) next.global.googleApiKey = global.googleApiKey.trim();
            if (typeof global.operatorToken === "string" && global.operatorToken.trim()) next.global.operatorToken = global.operatorToken.trim();
            if (global.requireOperatorToken !== undefined) next.global.requireOperatorToken = !!global.requireOperatorToken;
            if (global.localWritesOnly !== undefined) next.global.localWritesOnly = !!global.localWritesOnly;
            if (global.requireHumanApproval !== undefined) next.global.requireHumanApproval = !!global.requireHumanApproval;
            if (typeof global.whatsappTransport === "string" && ["openclaw_cli", "desktop_automation"].includes(global.whatsappTransport.trim())) next.global.whatsappTransport = global.whatsappTransport.trim();
            if (global.allowOpenClaw !== undefined) next.global.allowOpenClaw = !!global.allowOpenClaw;
            if (global.desktopFallback !== undefined) next.global.desktopFallback = !!global.desktopFallback;
        }

        // Worker
        const worker = incoming?.worker || {};
        if (worker && typeof worker === "object") {
            next.worker = { ...(current.worker || {}) };
            if (worker.pollIntervalSeconds !== undefined) {
                const v = parseInt(worker.pollIntervalSeconds, 10);
                next.worker.pollIntervalSeconds = Number.isFinite(v) ? Math.max(10, Math.min(v, 3600)) : current.worker.pollIntervalSeconds;
            }
            const q = worker.quantities || {};
            if (q && typeof q === "object") {
                next.worker.quantities = { ...(current.worker?.quantities || {}) };
                const clamp = (val, def, max) => {
                    const v = parseInt(val, 10);
                    return Number.isFinite(v) ? Math.max(0, Math.min(v, max)) : def;
                };
                if (q.imessage !== undefined) next.worker.quantities.imessage = clamp(q.imessage, current.worker.quantities.imessage, 5000);
                if (q.whatsapp !== undefined) next.worker.quantities.whatsapp = clamp(q.whatsapp, current.worker.quantities.whatsapp, 2000);
                if (q.gmail !== undefined) next.worker.quantities.gmail = clamp(q.gmail, current.worker.quantities.gmail, 500);
                if (q.notes !== undefined) next.worker.quantities.notes = clamp(q.notes, current.worker.quantities.notes, 5000);
            }
        }

        // UI
        const ui = incoming?.ui || {};
        if (ui && typeof ui === "object") {
            next.ui = { ...(current.ui || {}) };
            const channels = ui.channels || {};
            if (channels && typeof channels === "object") {
                next.ui.channels = { ...(current.ui?.channels || {}) };
                for (const key of ["imessage", "whatsapp", "email", "linkedin"]) {
                    if (!channels[key] || typeof channels[key] !== "object") continue;
                    next.ui.channels[key] = { ...(current.ui.channels[key] || {}) };
                    const ch = channels[key];
                    if (typeof ch.emoji === "string") next.ui.channels[key].emoji = ch.emoji.trim().slice(0, 4);
                    if (typeof ch.bubbleMe === "string") next.ui.channels[key].bubbleMe = ch.bubbleMe.trim().slice(0, 32);
                    if (typeof ch.bubbleContact === "string") next.ui.channels[key].bubbleContact = ch.bubbleContact.trim().slice(0, 32);
                }
            }
        }

        // Channel Bridge
        const channelBridge = incoming?.channelBridge || {};
        if (channelBridge && typeof channelBridge === "object") {
            next.channelBridge = { ...(current.channelBridge || {}), channels: { ...(current.channelBridge?.channels || {}) } };
            const channels = channelBridge.channels || {};
            if (channels && typeof channels === "object") {
                for (const key of CHANNEL_BRIDGE_CHANNELS) {
                    if (!channels[key] || typeof channels[key] !== "object") continue;
                    const mode = String(channels[key].inboundMode || "").trim().toLowerCase();
                    if (!next.channelBridge.channels[key]) next.channelBridge.channels[key] = {};
                    if (mode === "draft_only" || mode === "disabled") {
                        next.channelBridge.channels[key].inboundMode = mode;
                    }
                }
            }
        }

        writeSettings(next);
        writeJson(res, 200, { status: "ok" });
    } catch (e) {
        writeJson(res, 500, { error: e.message || "Failed to save settings" });
    }
}

async function serveGmailAuthUrl(req, res) {
    try {
        const settings = readSettings();
        const gmail = settings?.gmail || {};
        if (!gmail.clientId || !gmail.clientSecret) {
            writeJson(res, 400, { error: "Missing Gmail clientId/clientSecret in Settings" });
            return;
        }
        const baseUrl = `http://${req.headers.host}`;
        const redirectUri = `${baseUrl}/api/gmail/oauth-callback`;
        const state = crypto.randomBytes(16).toString("hex");
        gmailOauthState = { value: state, createdAt: Date.now() };
        const urlStr = buildAuthUrl({ clientId: gmail.clientId, redirectUri, state });
        writeJson(res, 200, { url: urlStr, redirectUri });
    } catch (e) {
        writeJson(res, 500, { error: e.message || "Failed to start Gmail auth" });
    }
}

async function serveGmailOAuthCallback(req, res, url) {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const err = url.searchParams.get("error");
    if (err) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end(`Gmail OAuth error: ${err}`);
        return;
    }
    if (!code) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Missing OAuth code");
        return;
    }
    if (!gmailOauthState || gmailOauthState.value !== state || (Date.now() - gmailOauthState.createdAt) > 10 * 60 * 1000) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Invalid OAuth state. Please try Connect Gmail again.");
        return;
    }

    try {
        const baseUrl = `http://${req.headers.host}`;
        const redirectUri = `${baseUrl}/api/gmail/oauth-callback`;
        await connectGmailFromCallback({ code, redirectUri });
        gmailOauthState = null;
        res.writeHead(302, { Location: `${baseUrl}/?gmail=connected` });
        res.end();
    } catch (e) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end(`Failed to connect Gmail: ${e.message}`);
    }
}

async function serveGmailDisconnect(req, res) {
    try {
        await disconnectGmail();
        writeJson(res, 200, { status: "ok" });
    } catch (e) {
        writeJson(res, 500, { error: e.message || "Failed to disconnect Gmail" });
    }
}

async function serveGmailCheck(req, res) {
    try {
        const info = await checkGmailConnection();
        writeJson(res, 200, { status: "ok", ...info });
    } catch (e) {
        writeJson(res, 500, { status: "error", error: e?.message || String(e) });
    }
}

module.exports = {
    serveSettings,
    serveGmailAuthUrl,
    serveGmailOAuthCallback,
    serveGmailDisconnect,
    serveGmailCheck
};
