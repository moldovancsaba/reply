const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { addDocuments } = require('./vector-store.js');
const contactStore = require('./contact-store.js');

const statusManager = require('./status-manager.js');
const { cleanMessageText } = require('./message-cleaner.js');

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
            console.log("[Debug] Gmail Config:", {
                clientId: settings.gmail?.clientId,
                hasClientSecret: !!settings.gmail?.clientSecret,
                hasRefreshToken: !!settings.gmail?.refreshToken,
                clientSecretHint: settings.gmail?.clientSecret?.slice(-4),
            });
            const maxMessages = Math.max(1, Math.min(Number(settings?.worker?.quantities?.gmail) || 500, 2000));
            const result = await syncGmail({ maxMessages });
            // Ensure result is an object with { added, hasMore }
            return (typeof result === 'object') ? result : { added: Number(result) || 0, hasMore: false };
        } catch (e) {
            console.error("[Mail Sync] Gmail sync failed:", e.message);
            updateStatus({ state: "error", message: e.message, connector: "gmail" });
            throw e;
        }
    }

    // IMAP: primary settings + optional extra `mailAccounts` rows (reply#21 follow-up).
    const { withDefaults, readSettings } = require('./settings-store.js');
    const settings = withDefaults(readSettings());
    const { syncImap, syncImapWithOptions } = require('./sync-imap.js');

    let imapTotal = 0;
    if (hasImapConfig()) {
        const added = await syncImap();
        imapTotal += Number(added) || 0;
    }

    const extra = (settings.mailAccounts || []).filter(
        (a) => a && a.enabled !== false && a.provider === 'imap' && a.imap?.host && a.imap?.user && a.imap?.pass
    );

    const primaryUser = (settings.imap?.user || '').trim().toLowerCase();
    const primaryHost = (settings.imap?.host || '').trim().toLowerCase();

    for (const acct of extra) {
        const im = acct.imap;
        const h = String(im.host || '').trim().toLowerCase();
        const u = String(im.user || '').trim().toLowerCase();
        if (hasImapConfig() && h === primaryHost && u === primaryUser) {
            console.log(`[Mail Sync] Skipping extra account ${acct.id} (same as primary IMAP)`);
            continue;
        }
        try {
            const n = await syncImapWithOptions({
                accountId: acct.id,
                label: acct.label || acct.id,
                host: im.host,
                user: im.user,
                pass: im.pass,
                port: im.port,
                secure: im.secure !== false,
                mailbox: im.mailbox || 'INBOX',
                sentMailbox: im.sentMailbox || '',
                limit: im.limit || 200,
                sinceDays: im.sinceDays || 30,
                selfEmails: im.selfEmails || '',
            });
            imapTotal += Number(n) || 0;
        } catch (e) {
            console.error(`[Mail Sync] Extra IMAP account ${acct.id} failed:`, e.message);
            updateStatus({ state: 'error', message: `IMAP ${acct.label || acct.id}: ${e.message}`, connector: 'imap' });
        }
    }

    if (hasImapConfig() || extra.length > 0) {
        return { added: imapTotal, hasMore: false };
    }

    console.log("Synchronizing Apple Mail...");
    updateStatus({ state: "running", message: "Fetching emails from Mail.app..." });

    // We'll target the last 2000 messages from each
    const BATCH_SIZE = 2000;
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
            if (direction === 'contact') {
                await contactStore.markChannelInboundVerified(cleanHandle, cleanHandle, date);
            }

            // 2. Prepare Vector Document
            docs.push({
                id: `mail-${Buffer.from(date + subject + cleanHandle).toString('base64').slice(0, 16)}`,
                text: `[${date}] ${direction === 'me' ? 'Me' : cleanHandle}: Subject: ${subject}\n\n${cleanMessageText(body).slice(0, 1000)}`,
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

        return { added: docs.length, hasMore: false };

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
