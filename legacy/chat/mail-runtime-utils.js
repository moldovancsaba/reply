"use strict";

const fs = require("fs");
const path = require("path");

const APPLE_MAIL_INDEX_ENV = "REPLY_APPLE_MAIL_INDEX_PATH";

function resolveAppleMailIndexPath() {
    const explicit = String(process.env[APPLE_MAIL_INDEX_ENV] || "").trim();
    if (explicit && fs.existsSync(explicit)) return explicit;

    const mailRoot = path.join(process.env.HOME || "", "Library", "Mail");
    let entries = [];
    try {
        entries = fs.readdirSync(mailRoot, { withFileTypes: true });
    } catch {
        return "";
    }

    const candidates = entries
        .filter((entry) => entry.isDirectory() && /^V\d+$/.test(entry.name))
        .map((entry) => {
            const version = Number(entry.name.slice(1));
            const targetPath = path.join(mailRoot, entry.name, "MailData", "Envelope Index");
            if (!fs.existsSync(targetPath)) return null;
            let mtimeMs = 0;
            try {
                mtimeMs = fs.statSync(targetPath).mtimeMs || 0;
            } catch {
                mtimeMs = 0;
            }
            return { targetPath, version, mtimeMs };
        })
        .filter(Boolean)
        .sort((left, right) => {
            if (left.version !== right.version) return right.version - left.version;
            return right.mtimeMs - left.mtimeMs;
        });

    return candidates[0]?.targetPath || "";
}

function buildMailStatus(currentStatus = {}, status = {}, connector = "") {
    const now = new Date().toISOString();
    const state = String(status?.state || currentStatus.state || "idle").trim().toLowerCase();
    const successfulAt = state === "error"
        ? (currentStatus.lastSuccessfulSync || currentStatus.lastSync || null)
        : (status?.lastSuccessfulSync || status?.lastSync || now);
    return {
        connector: connector || status?.connector || currentStatus.connector || "",
        state,
        message: String(status?.message || ""),
        progress: Number.isFinite(Number(status?.progress)) ? Number(status.progress) : (state === "running" ? 0 : 100),
        processed: Number.isFinite(Number(status?.processed)) ? Number(status.processed) : Math.max(0, Number(currentStatus.processed) || 0),
        lastSync: status?.lastSync !== undefined ? status.lastSync : (state === "error" ? currentStatus.lastSync || null : successfulAt),
        lastSuccessfulSync: successfulAt,
        lastAttemptedSync: now,
    };
}

module.exports = {
    APPLE_MAIL_INDEX_ENV,
    resolveAppleMailIndexPath,
    buildMailStatus,
};
