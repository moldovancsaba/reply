/**
 * Resolve local WhatsApp Desktop ChatStorage.sqlite for sync and JID resolution.
 * Tries REPLY_WHATSAPP_DB_PATH, then common macOS install locations (reply: multi-path discovery).
 */

const fs = require("fs");
const path = require("path");

function whatsAppChatStorageCandidates() {
    const home = process.env.HOME || "";
    if (!home) return [];
    const rel = [
        "Library/Group Containers/group.net.whatsapp.WhatsApp.shared/ChatStorage.sqlite",
        "Library/Containers/net.whatsapp.WhatsApp/Data/Library/Application Support/WhatsApp/ChatStorage.sqlite",
        "Library/Containers/com.whatsapp/Data/Library/Application Support/WhatsApp/ChatStorage.sqlite",
        "Library/Containers/desktop.WhatsApp/Data/Library/Application Support/WhatsApp/ChatStorage.sqlite"
    ];
    return rel.map((r) => path.join(home, r));
}

/**
 * @returns {string} Absolute path to use for ChatStorage.sqlite (may not exist if misconfigured).
 */
function resolveWhatsAppChatStoragePath() {
    const env = String(process.env.REPLY_WHATSAPP_DB_PATH || "").trim();
    if (env) return path.resolve(env);

    for (const p of whatsAppChatStorageCandidates()) {
        if (fs.existsSync(p)) return p;
    }
    const c = whatsAppChatStorageCandidates();
    return c[0] || "";
}

module.exports = {
    resolveWhatsAppChatStoragePath,
    whatsAppChatStorageCandidates
};
