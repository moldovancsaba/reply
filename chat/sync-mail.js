const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { addDocuments } = require('./vector-store.js');
const contactStore = require('./contact-store.js');

const statusManager = require('./status-manager.js');

const MAX_BUFFER = 1024 * 1024 * 100; // 100MB for large mailboxes

function updateStatus(status) {
    statusManager.update('mail', status);
}

function hasGmailConfig() {
    try {
        const { readSettings, isGmailConfigured } = require('./settings-store.js');
        return isGmailConfigured(readSettings());
    } catch {
        return false;
    }
}

function hasImapConfig() {
    try {
        const { readSettings, isImapConfigured } = require('./settings-store.js');
        return isImapConfigured(readSettings());
    } catch {
        return !!(process.env.REPLY_IMAP_HOST && process.env.REPLY_IMAP_USER && process.env.REPLY_IMAP_PASS);
    }
}

function runAppleScript(script) {
    return new Promise((resolve, reject) => {
        const escapedScript = script.replace(/'/g, "'\\''");
        exec(`osascript -e '${escapedScript}'`, { maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            resolve(stdout.trim());
        });
    });
}

/**
 * Enhanced sync script for {reply}.
 * Extracts: Date, Subject, Sender, Receiver, Content from Sent and Inbox.
 * @returns {Promise<number>} Number of synced emails
 */
async function syncMail() {
    // Prefer Gmail OAuth connector if configured.
    if (hasGmailConfig()) {
        const { syncGmail } = require('./gmail-connector.js');
        try {
            const { withDefaults, readSettings } = require('./settings-store.js');
            const settings = withDefaults(readSettings());
            const maxMessages = Math.max(1, Math.min(Number(settings?.worker?.quantities?.gmail) || 100, 500));
            return await syncGmail({ maxMessages });
        } catch {
            return await syncGmail({ maxMessages: 100 });
        }
    }

    // Prefer IMAP connector (supports Gmail via IMAP/App Password) when configured.
    if (hasImapConfig()) {
        const { syncImap } = require('./sync-imap.js');
        return await syncImap();
    }

    console.log("Synchronizing Apple Mail...");
    updateStatus({ state: "running", message: "Fetching emails from Mail.app..." });

    // We'll target the last 500 messages from each to keep it snappy for the POC
    const BATCH_SIZE = 500;
    const delimiter = "||MB||";
    const fieldDelimiter = "||FD||";

    const script = `
        set out to ""
        tell application "Mail"
            -- Process Sent Mailbox
            try
                set sentMsgs to (messages 1 thru ${BATCH_SIZE} of sent mailbox)
                repeat with msg in sentMsgs
                    set d to (date received of msg) as string
                    set s to (subject of msg)
                    set r to (address of (recipient 1 of msg))
                    set c to (content of msg)
                    set out to out & d & "${fieldDelimiter}" & s & "${fieldDelimiter}" & r & "${fieldDelimiter}" & "me" & "${fieldDelimiter}" & c & "${delimiter}"
                end repeat
            end try

            -- Process Inbox
            try
                set inboxMsgs to (messages 1 thru ${BATCH_SIZE} of inbox)
                repeat with msg in inboxMsgs
                    set d to (date received of msg) as string
                    set s to (subject of msg)
                    set r to (sender of msg)
                    set c to (content of msg)
                    set out to out & d & "${fieldDelimiter}" & s & "${fieldDelimiter}" & r & "${fieldDelimiter}" & "contact" & "${fieldDelimiter}" & c & "${delimiter}"
                end repeat
            end try
        end tell
        return out
    `;

    try {
        const raw = await runAppleScript(script);
        const entries = raw.split(delimiter).filter(e => e.includes(fieldDelimiter));

        console.log(`Processing ${entries.length} emails...`);
        updateStatus({ state: "running", progress: 30, message: `Processing ${entries.length} emails...` });

        const docs = [];

        for (const entry of entries) {
            const [date, subject, handle, direction, body] = entry.split(fieldDelimiter);
            if (!handle || !body) continue;

            const cleanHandle = handle.toLowerCase().trim();

            // 1. Update Contact Store
            contactStore.updateLastContacted(cleanHandle, date, { channel: 'email' });

            // 2. Prepare Vector Document
            docs.push({
                id: `mail-${Buffer.from(date + subject + cleanHandle).toString('base64').slice(0, 16)}`,
                text: `[${date}] ${direction === 'me' ? 'Me' : cleanHandle}: Subject: ${subject}\n\n${body.slice(0, 1000)}`,
                source: 'Mail',
                path: `mailto:${cleanHandle}`
            });
        }

        if (docs.length > 0) {
            updateStatus({ state: "running", progress: 70, message: `Vectorizing ${docs.length} emails...` });
            await addDocuments(docs);
            console.log("Mail sync complete.");

            // Get current count and add new emails
            const currentStatus = statusManager.get('mail');
            const currentCount = currentStatus.processed || 0;

            updateStatus({ state: "idle", lastSync: new Date().toISOString(), processed: currentCount + docs.length });
        } else {
            // No new emails - preserve existing count
            const currentStatus = statusManager.get('mail');
            const currentCount = currentStatus.processed || 0;

            updateStatus({ state: "idle", lastSync: new Date().toISOString(), processed: currentCount, message: "No new emails found" });
        }

        return docs.length;

    } catch (e) {
        console.error("Mail Sync Error:", e);
        updateStatus({ state: "error", message: e.message });
        throw e;
    }
}

if (require.main === module) {
    syncMail().then(count => console.log(`Finished. Synced ${count} emails.`));
}

module.exports = { syncMail };
module.exports.isImapConfigured = hasImapConfig;
module.exports.isGmailConfigured = hasGmailConfig;
