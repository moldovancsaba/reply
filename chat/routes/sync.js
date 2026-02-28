/**
 * {reply} - Sync Routes
 * Handles background synchronization for various data sources.
 */

const { writeJson } = require("../utils/server-utils");
const { readSettings, withDefaults } = require("../settings-store");
const { syncNotes } = require("../sync-notes");
const { execFile } = require("child_process");
const path = require("path");
const syncGuard = require("../utils/sync-guard");

/**
 * API Endpoint: /api/sync-notes
 */
function serveSyncNotes(req, res) {
    if (syncGuard.isLocked("notes")) {
        return writeJson(res, 409, { status: "error", message: "Notes sync already in progress" });
    }
    syncGuard.acquireLock("notes");

    const settings = withDefaults(readSettings());
    const notesLimit = Number(settings?.worker?.quantities?.notes) || 0;

    console.log("Starting Apple Notes sync in background...");
    syncNotes(notesLimit > 0 ? notesLimit : null)
        .then((stats) => {
            console.log("Notes sync completed:", stats);
        })
        .catch((err) => {
            console.error("Notes sync error:", err);
        })
        .finally(() => {
            syncGuard.releaseLock("notes");
        });

    writeJson(res, 200, { status: "started", message: "Sync started in background" });
}

/**
 * API Endpoint: /api/sync-imessage
 */
function serveSyncIMessage(req, res) {
    if (syncGuard.isLocked("imessage")) {
        return writeJson(res, 409, { status: "error", message: "iMessage sync already in progress" });
    }
    syncGuard.acquireLock("imessage");

    console.log("Starting iMessage sync in background...");
    const scriptPath = path.join(__dirname, "../sync-imessage.js");
    execFile(process.execPath, [scriptPath], { cwd: path.join(__dirname, "..") }, (error, stdout, stderr) => {
        syncGuard.releaseLock("imessage");
        if (error) {
            console.error(`iMessage sync error: ${error.message}`);
            return;
        }
        console.log(`iMessage sync completed: ${stdout.trim()}`);
    });

    writeJson(res, 200, { status: "started", message: "iMessage sync started in background" });
}

/**
 * API Endpoint: /api/sync-mail
 */
function serveSyncMail(req, res) {
    if (syncGuard.isLocked("mail")) {
        return writeJson(res, 409, { status: "error", message: "Mail sync already in progress" });
    }
    syncGuard.acquireLock("mail");

    console.log("Starting Mail sync in background...");
    const { syncMail } = require("../sync-mail");
    syncMail().then(count => {
        console.log(`Mail sync completed: ${count} emails.`);
    }).catch(err => {
        console.error(`Mail sync error: ${err.message}`);
    }).finally(() => {
        syncGuard.releaseLock("mail");
    });

    writeJson(res, 200, { status: "started", message: "Mail sync started in background" });
}

/**
 * API Endpoint: /api/sync-whatsapp
 */
function serveSyncWhatsApp(req, res) {
    if (syncGuard.isLocked("whatsapp")) {
        return writeJson(res, 409, { status: "error", message: "WhatsApp sync already in progress" });
    }
    syncGuard.acquireLock("whatsapp");

    console.log("Starting WhatsApp sync in background...");
    const { syncWhatsApp } = require("../sync-whatsapp");
    syncWhatsApp().then(stats => {
        console.log("WhatsApp sync completed:", stats);
    }).catch(err => {
        console.error("WhatsApp sync error:", err);
    }).finally(() => {
        syncGuard.releaseLock("whatsapp");
    });

    writeJson(res, 200, { status: "started", message: "WhatsApp sync started in background" });
}

/**
 * API Endpoint: /api/sync-linkedin
 */
function serveSyncLinkedIn(req, res) {
    if (syncGuard.isLocked("linkedin")) {
        return writeJson(res, 409, { status: "error", message: "LinkedIn sync already in progress" });
    }
    syncGuard.acquireLock("linkedin");

    console.log("Starting LinkedIn sync in background...");
    const { syncLinkedIn } = require("../sync-linkedin");
    syncLinkedIn().then(stats => {
        console.log("LinkedIn sync completed:", stats);
    }).catch(err => {
        console.error("LinkedIn sync error:", err);
    }).finally(() => {
        syncGuard.releaseLock("linkedin");
    });

    writeJson(res, 200, { status: "started", message: "LinkedIn sync started in background" });
}

/**
 * API Endpoint: /api/sync-contacts
 */
function serveSyncContacts(req, res) {
    if (syncGuard.isLocked("contacts")) {
        return writeJson(res, 409, { status: "error", message: "Contacts sync already in progress" });
    }
    syncGuard.acquireLock("contacts");

    console.log("Starting Apple Contacts sync in background...");
    const { ingestContacts } = require("../ingest-contacts");
    ingestContacts().then(count => {
        console.log(`Apple Contacts sync completed: ${count} contacts.`);
    }).catch(err => {
        console.error(`Apple Contacts sync error: ${err.message}`);
    }).finally(() => {
        syncGuard.releaseLock("contacts");
    });

    writeJson(res, 200, { status: "started", message: "Contacts sync started in background" });
}

/**
 * API Endpoint: /api/sync-linkedin-posts
 */
function serveSyncLinkedInPosts(req, res) {
    if (syncGuard.isLocked("linkedin_posts")) {
        return writeJson(res, 409, { status: "error", message: "LinkedIn Posts sync already in progress" });
    }
    syncGuard.acquireLock("linkedin_posts");

    console.log("Starting LinkedIn Posts sync in background...");
    const { ingestLinkedInPosts } = require("../ingest-linkedin-posts");
    const csvPath = path.join(__dirname, "../data/Shares.csv"); // Default convention
    ingestLinkedInPosts(csvPath).then(result => {
        console.log("LinkedIn Posts sync completed:", result);
    }).catch(err => {
        console.error("LinkedIn Posts sync error:", err);
    }).finally(() => {
        syncGuard.releaseLock("linkedin_posts");
    });

    writeJson(res, 200, { status: "started", message: "LinkedIn Posts sync started in background" });
}

/**
 * API Endpoint: /api/sync-kyc
 */
function serveSyncKyc(req, res) {
    if (syncGuard.isLocked("kyc")) {
        return writeJson(res, 409, { status: "error", message: "KYC Intelligence sweep already in progress" });
    }
    syncGuard.acquireLock("kyc");

    console.log("Starting KYC Intelligence sync in background...");
    const { run: runKyc } = require("../kyc-agent");
    runKyc().then(() => {
        console.log("KYC Intelligence sync completed.");
    }).catch(err => {
        console.error("KYC Intelligence sync error:", err);
    }).finally(() => {
        syncGuard.releaseLock("kyc");
    });

    writeJson(res, 200, { status: "started", message: "KYC sync started in background" });
}

/**
 * API Endpoint: /api/import/linkedin
 * Accepts raw JSON body (LinkedIn data archive) and ingests it.
 */
function serveImportLinkedIn(req, res) {
    if (req.method !== 'POST') {
        return writeJson(res, 405, { error: 'Method not allowed' });
    }
    if (syncGuard.isLocked("linkedin_import")) {
        return writeJson(res, 409, { status: "error", message: "LinkedIn import already in progress" });
    }
    syncGuard.acquireLock("linkedin_import");

    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const tmpPath = path.join(__dirname, '../data/_linkedin_import_tmp.json');
            require('fs').writeFileSync(tmpPath, body, 'utf8');

            const { ingestLinkedInPosts } = require('../ingest-linkedin-posts');
            const result = await ingestLinkedInPosts(tmpPath);
            require('fs').unlinkSync(tmpPath);
            writeJson(res, 200, { status: 'ok', count: result?.count || 0, errors: result?.errors || 0 });
        } catch (err) {
            console.error('[Import] LinkedIn import error:', err);
            writeJson(res, 500, { error: err.message });
        } finally {
            syncGuard.releaseLock("linkedin_import");
        }
    });
}

module.exports = {
    serveSyncNotes,
    serveSyncIMessage,
    serveSyncMail,
    serveSyncWhatsApp,
    serveSyncLinkedIn,
    serveSyncContacts,
    serveSyncLinkedInPosts,
    serveSyncKyc,
    serveImportLinkedIn
};
