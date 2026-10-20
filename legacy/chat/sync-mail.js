const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { addDocuments } = require('./vector-store.js');
const { enqueueSuggestionDraftsFromDocBatch } = require('./suggestion-draft-queue.js');
const { saveMessages } = require('./message-store.js');
const contactStore = require('./contact-store.js');
const { dataPath, ensureDataHome } = require('./app-paths.js');

const statusManager = require('./status-manager.js');
const { cleanMessageText } = require('./message-cleaner.js');
const { normalizeEmail } = require('./utils/chat-utils.js');
const { APPLE_MAIL_INDEX_ENV, resolveAppleMailIndexPath, buildMailStatus } = require('./mail-runtime-utils.js');

const APPLE_MAIL_STATE_FILE = dataPath('apple_mail_sync_state.json');

function updateStatus(status) {
    statusManager.replace('mail', status);
}

function readCurrentMailStatus() {
    try {
        return statusManager.get('mail') || {};
    } catch {
        return {};
    }
}

function updateMailStatus(status, connector) {
    return updateStatus(buildMailStatus(readCurrentMailStatus(), status, connector));
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

function extractEmailAddress(headerVal) {
    const s = String(headerVal || "").trim();
    if (!s) return null;
    const m = s.match(/<([^>]+)>/);
    return normalizeEmail(m ? m[1] : s);
}

function normalizeMailDate(raw) {
    const input = String(raw || "").trim();
    if (!input) return new Date().toISOString();
    const normalized = input.replace(/\s+at\s+/i, " ").trim();
    const direct = new Date(input);
    if (!Number.isNaN(direct.getTime())) return direct.toISOString();
    const fallback = new Date(normalized);
    if (!Number.isNaN(fallback.getTime())) return fallback.toISOString();
    return new Date().toISOString();
}

function loadAppleMailState() {
    ensureDataHome();
    if (!fs.existsSync(APPLE_MAIL_STATE_FILE)) {
        return { lastRowId: 0, sourceMaxRowId: 0, complete: false };
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(APPLE_MAIL_STATE_FILE, 'utf8'));
        return {
            lastRowId: Math.max(0, Number(parsed?.lastRowId) || 0),
            sourceMaxRowId: Math.max(0, Number(parsed?.sourceMaxRowId) || 0),
            complete: Boolean(parsed?.complete),
        };
    } catch {
        return { lastRowId: 0, sourceMaxRowId: 0, complete: false };
    }
}

function saveAppleMailState(next) {
    ensureDataHome();
    const state = {
        lastRowId: Math.max(0, Number(next?.lastRowId) || 0),
        sourceMaxRowId: Math.max(0, Number(next?.sourceMaxRowId) || 0),
        complete: Boolean(next?.complete),
        updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(APPLE_MAIL_STATE_FILE, JSON.stringify(state, null, 2));
    return state;
}

function openAppleMailIndex() {
    const dbPath = resolveAppleMailIndexPath();
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
            if (err) {
                try {
                    db.close();
                } catch {
                    // Ignore cleanup errors when the open callback itself failed.
                }
                reject(err);
                return;
            }
            resolve(db);
        });
    });
}

function runDbAll(db, query, params = []) {
    return new Promise((resolve, reject) => {
        db.all(query, params, (err, rows) => {
            if (err) return reject(err);
            resolve(Array.isArray(rows) ? rows : []);
        });
    });
}

function runDbGet(db, query, params = []) {
    return new Promise((resolve, reject) => {
        db.get(query, params, (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });
}

function appleMailIndexExists() {
    return !!resolveAppleMailIndexPath();
}


function decodeMailboxUrl(raw) {
    const value = String(raw || '').trim();
    if (!value) return '';
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function isExcludedAppleMailbox(url) {
    const lower = decodeMailboxUrl(url).toLowerCase();
    return (
        lower.includes('/junk') ||
        lower.includes('/spam') ||
        lower.includes('deleted messages') ||
        lower.includes('/trash') ||
        lower.includes('/draft') ||
        lower.includes('/outbox') ||
        lower.includes('/notes') ||
        lower.includes('/sendlater') ||
        lower.includes('recovered messages')
    );
}

function isSentAppleMailbox(url) {
    const lower = decodeMailboxUrl(url).toLowerCase();
    return (
        lower.includes('sent messages') ||
        lower.endsWith('/sent') ||
        lower.includes('/sent/')
    );
}

function toIsoFromUnixSeconds(value) {
    const seconds = Number(value) || 0;
    if (!seconds) return new Date().toISOString();
    return new Date(seconds * 1000).toISOString();
}

function resolveReplyHelperPath() {
    const explicit = String(process.env.REPLY_HELPER_PATH || "").trim();
    if (explicit && fs.existsSync(explicit)) {
        return explicit;
    }
    return null;
}

function execFileAsync(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const { execFile } = require('child_process');
        execFile(command, args, options, (error, stdout, stderr) => {
            if (error) {
                error.stdout = stdout;
                error.stderr = stderr;
                return reject(error);
            }
            resolve({ stdout, stderr });
        });
    });
}

async function loadRowsViaHelper(afterRowId, limit) {
    const helperPath = resolveReplyHelperPath();
    if (!helperPath) {
        return null;
    }
    const args = [
        'export-mail',
        '--after-rowid', String(afterRowId),
        '--limit', String(limit),
    ];
    const explicitIndexPath = String(process.env[APPLE_MAIL_INDEX_ENV] || '').trim();
    if (explicitIndexPath) {
        args.splice(1, 0, '--db-path', explicitIndexPath);
    }
    const { stdout } = await execFileAsync(helperPath, args, {
        maxBuffer: 25 * 1024 * 1024,
    });
    return JSON.parse(stdout || '{}');
}

async function getAppleMailSourceMaxRowId(db) {
    const row = await runDbGet(db, "SELECT MAX(ROWID) AS maxRowId FROM messages");
    return Math.max(0, Number(row?.maxRowId) || 0);
}

async function collectAppleMailSelfEmails(db) {
    const rows = await runDbAll(
        db,
        `
        SELECT DISTINCT a.address AS address, mb.url AS mailbox_url
        FROM messages m
        JOIN addresses a ON a.ROWID = m.sender
        JOIN mailboxes mb ON mb.ROWID = m.mailbox
        WHERE a.address IS NOT NULL AND TRIM(a.address) != ''
        `
    );
    const selfEmails = new Set();
    for (const row of rows) {
        if (!isSentAppleMailbox(row?.mailbox_url)) continue;
        const email = extractEmailAddress(row?.address);
        if (email) selfEmails.add(email);
    }
    return selfEmails;
}

async function loadAppleMailRecipientMap(db, messageRowIds = []) {
    const ids = Array.from(new Set((messageRowIds || []).map((v) => Number(v) || 0).filter(Boolean)));
    if (!ids.length) return new Map();
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await runDbAll(
        db,
        `
        SELECT r.message AS message_rowid, a.address AS address, r.type AS type, r.position AS position
        FROM recipients r
        JOIN addresses a ON a.ROWID = r.address
        WHERE r.message IN (${placeholders})
        ORDER BY r.message ASC, COALESCE(r.type, 0) ASC, COALESCE(r.position, 0) ASC
        `,
        ids
    );
    const out = new Map();
    for (const row of rows) {
        const list = out.get(row.message_rowid) || [];
        const address = extractEmailAddress(row.address);
        if (address) {
            list.push(address);
            out.set(row.message_rowid, list);
        }
    }
    return out;
}

function chooseAppleMailHandle({ senderAddress, mailboxUrl, recipientAddresses, selfEmails }) {
    const sender = extractEmailAddress(senderAddress);
    const recipients = Array.isArray(recipientAddresses) ? recipientAddresses.filter(Boolean) : [];
    const fromMe = isSentAppleMailbox(mailboxUrl) || (sender && selfEmails.has(sender));
    if (fromMe) {
        return {
            isFromMe: true,
            handle: recipients.find((addr) => !selfEmails.has(addr)) || recipients[0] || sender || null
        };
    }
    return {
        isFromMe: false,
        handle: sender || recipients.find((addr) => !selfEmails.has(addr)) || recipients[0] || null
    };
}

function buildEmailParticipantIdentities({ senderAddress, recipientAddresses = [], selfEmails }) {
    const identities = new Set();
    const sender = extractEmailAddress(senderAddress);
    if (sender && !selfEmails.has(sender)) identities.add(sender);
    for (const recipient of recipientAddresses) {
        const normalized = extractEmailAddress(recipient);
        if (normalized && !selfEmails.has(normalized)) identities.add(normalized);
    }
    return Array.from(identities);
}

function buildEmailMetadata({
    channel = "email",
    providerMessageKey,
    externalThreadKey,
    externalThreadTitle,
    senderAddress,
    recipientAddresses = [],
    selfEmails,
}) {
    const sender = extractEmailAddress(senderAddress);
    const recipients = recipientAddresses.map((value) => extractEmailAddress(value)).filter(Boolean);
    const participantIdentities = buildEmailParticipantIdentities({
        senderAddress,
        recipientAddresses,
        selfEmails,
    });
    return {
        providerMessageKey: String(providerMessageKey || "").trim() || null,
        channel,
        externalThreadKey: String(externalThreadKey || "").trim() || null,
        externalThreadKind: participantIdentities.length > 1 ? "group" : "direct",
        externalThreadTitle: String(externalThreadTitle || "").trim() || null,
        senderIdentity: sender || null,
        participantIdentities,
        recipientIdentities: recipients.filter((value) => !selfEmails.has(value)),
    };
}

/**
 * Sync mail into the local conversation corpus.
 *
 * Order of preference:
 * 1. Gmail OAuth connector
 * 2. IMAP accounts
 * 3. Apple Mail fallback
 *
 * Returns a bounded sync summary instead of a raw count so callers can tell
 * whether additional backfill work remains. The fallback order is operational,
 * not additive: Gmail is preferred first, then IMAP, then Apple Mail fallback
 * if the earlier paths are unavailable or not configured.
 *
 * @returns {Promise<{ added: number, hasMore: boolean }>}
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
            updateMailStatus({ state: "error", message: `Gmail failed, falling back to local mail: ${e.message}` }, "gmail");
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
            updateMailStatus({ state: 'error', message: `IMAP ${acct.label || acct.id}: ${e.message}` }, 'imap');
        }
    }

    if (hasImapConfig() || extra.length > 0) {
        return { added: imapTotal, hasMore: false };
    }

    const helperPath = resolveReplyHelperPath();
    const helperRequired = process.platform === 'darwin' && String(process.env.REPLY_RELEASE_MODE || '').trim() === '1';
    if (helperRequired && !helperPath) {
        const msg = "Apple Mail fallback requires the bundled protected-data helper.";
        updateMailStatus({ state: "error", message: msg }, "apple_mail");
        throw new Error(msg);
    }

    if (!helperPath && !appleMailIndexExists()) {
        const msg = `Apple Mail index not found under ~/Library/Mail or ${APPLE_MAIL_INDEX_ENV}.`;
        updateMailStatus({ state: "error", message: msg }, "apple_mail");
        throw new Error(msg);
    }

    console.log("Synchronizing Apple Mail index...");
    updateMailStatus({ state: "running", message: "Reading Apple Mail index..." }, "apple_mail");

    let db = null;
    try {
        const state = loadAppleMailState();
        const maxMessages = Math.max(100, Math.min(Number(settings?.worker?.quantities?.mail) || 1000, 5000));
        let sourceMaxRowId = 0;
        let selfEmails = new Set();
        let filtered = [];

        console.log(`Processing Apple Mail index rows > ${state.lastRowId}...`);
        updateMailStatus({ state: "running", progress: 20, message: `Processing Apple Mail index rows > ${state.lastRowId}...` }, "apple_mail");

        let savedCount = 0;
        if (helperPath) {
            const helperPayload = await loadRowsViaHelper(state.lastRowId, maxMessages * 3);
            sourceMaxRowId = Math.max(0, Number(helperPayload?.sourceMaxRowID) || 0);
            selfEmails = new Set((helperPayload?.selfEmails || []).map((value) => extractEmailAddress(value)).filter(Boolean));
            filtered = (helperPayload?.rows || [])
                .filter((row) => !isExcludedAppleMailbox(row.mailboxURL))
                .slice(0, maxMessages)
                .map((row) => ({
                    rowid: Number(row.rowID) || 0,
                    global_message_id: row.globalMessageID || '',
                    document_id: row.documentID || '',
                    conversation_id: row.conversationID || '',
                    date_sent: Number(row.dateSent) || 0,
                    date_received: Number(row.dateReceived) || 0,
                    mailbox_url: row.mailboxURL || '',
                    sender_address: row.senderAddress || '',
                    subject: row.subject || '',
                    summary: row.summary || '',
                    recipients: Array.isArray(row.recipients) ? row.recipients : [],
                }));
        } else {
            db = await openAppleMailIndex();
            db.run("PRAGMA journal_mode = WAL");
            db.run("PRAGMA busy_timeout = 5000");
            sourceMaxRowId = await getAppleMailSourceMaxRowId(db);
            selfEmails = await collectAppleMailSelfEmails(db);
            const rows = await runDbAll(
                db,
                `
                SELECT
                    m.ROWID AS rowid,
                    m.global_message_id AS global_message_id,
                    m.document_id AS document_id,
                    m.conversation_id AS conversation_id,
                    m.date_sent AS date_sent,
                    m.date_received AS date_received,
                    mb.url AS mailbox_url,
                    a.address AS sender_address,
                    subj.subject AS subject,
                    sm.summary AS summary
                FROM messages m
                LEFT JOIN mailboxes mb ON mb.ROWID = m.mailbox
                LEFT JOIN addresses a ON a.ROWID = m.sender
                LEFT JOIN subjects subj ON subj.ROWID = m.subject
                LEFT JOIN summaries sm ON sm.ROWID = m.summary
                WHERE m.ROWID > ?
                  AND m.deleted = 0
                ORDER BY m.ROWID ASC
                LIMIT ?
                `,
                [state.lastRowId, maxMessages * 3]
            );
            const recipientMap = await loadAppleMailRecipientMap(db, rows.map((row) => row.rowid));
            filtered = rows
                .filter((row) => !isExcludedAppleMailbox(row.mailbox_url))
                .slice(0, maxMessages)
                .map((row) => ({
                    ...row,
                    recipients: recipientMap.get(row.rowid) || [],
                }));
        }
        const docs = [];
        const unifiedDocs = [];
        let lastProcessedRowId = state.lastRowId;

        for (const row of filtered) {
            lastProcessedRowId = Math.max(lastProcessedRowId, Number(row.rowid) || 0);
            const recipients = Array.isArray(row.recipients) ? row.recipients : [];
            const { isFromMe, handle } = chooseAppleMailHandle({
                senderAddress: row.sender_address,
                mailboxUrl: row.mailbox_url,
                recipientAddresses: recipients,
                selfEmails
            });
            const cleanHandle = extractEmailAddress(handle);
            if (!cleanHandle) continue;
            const isoDate = toIsoFromUnixSeconds(row.date_received || row.date_sent);
            const summaryText = cleanMessageText(row.summary || "").slice(0, 4000);
            const subjectText = String(row.subject || "").trim();
            const storedText = summaryText || subjectText;
            if (!storedText) continue;
            const stableKey = row.global_message_id || row.document_id || row.rowid;
            const messageId = `mailidx-${stableKey}`;

            void contactStore.updateLastContacted(cleanHandle, isoDate, { channel: 'email' }).catch((error) => {
                console.warn("[sync-mail] Failed to update last-contacted:", error.message);
            });
            if (!isFromMe) {
                await contactStore.markChannelInboundVerified(cleanHandle, cleanHandle, isoDate);
            }

            docs.push({
                id: messageId,
                text: `[${isoDate}] ${isFromMe ? 'Me' : cleanHandle}: Subject: ${subjectText}\n\n${storedText.slice(0, 1000)}`,
                source: 'Mail',
                path: `mailto:${cleanHandle}`
            });
            unifiedDocs.push({
                id: messageId,
                text: storedText,
                source: 'Mail',
                handle: cleanHandle,
                timestamp: isoDate,
                path: `mailto:${cleanHandle}`,
                is_from_me: isFromMe,
                metadata: buildEmailMetadata({
                    providerMessageKey: stableKey,
                    externalThreadKey: row.conversation_id ? `apple-mail:${row.conversation_id}` : null,
                    externalThreadTitle: subjectText,
                    senderAddress: row.sender_address,
                    recipientAddresses: recipients,
                    selfEmails,
                })
            });
        }

        if (unifiedDocs.length) {
            await saveMessages(unifiedDocs);
            savedCount += unifiedDocs.length;
            updateMailStatus({
                state: "running",
                progress: 80,
                message: `Saved ${savedCount} Apple Mail index rows...`
            }, "apple_mail");
            try {
                await addDocuments(docs);
                enqueueSuggestionDraftsFromDocBatch(docs);
            } catch (vectorErr) {
                console.warn("[Mail Sync] Vector indexing failed after index save:", vectorErr.message);
            }
        }

        const nextState = saveAppleMailState({
            lastRowId: lastProcessedRowId,
            sourceMaxRowId,
            complete: lastProcessedRowId >= sourceMaxRowId
        });
        db.close();
        db = null;

        if (savedCount > 0) {
            console.log("Mail index sync complete.");

            const currentStatus = readCurrentMailStatus();
            const currentCount = currentStatus.processed || 0;

            updateMailStatus({ state: "idle", lastSync: new Date().toISOString(), processed: currentCount + savedCount }, "apple_mail");
        } else {
            const currentStatus = readCurrentMailStatus();
            const currentCount = currentStatus.processed || 0;

            updateMailStatus({ state: "idle", lastSync: new Date().toISOString(), processed: currentCount, message: "No new Apple Mail index rows found" }, "apple_mail");
        }

        return { added: savedCount, hasMore: nextState.lastRowId < sourceMaxRowId };

    } catch (e) {
        console.error("Mail Sync Error:", e);
        updateMailStatus({ state: "error", message: e.message }, "apple_mail");
        throw e;
    } finally {
        if (db) {
            try {
                db.close();
            } catch {
                // Ignore close errors during fallback sync cleanup.
            }
        }
    }
}

if (require.main === module) {
    syncMail().then((result) => {
        const added = typeof result === "object" ? Number(result.added) || 0 : Number(result) || 0;
        console.log(`Finished. Synced ${added} emails.`);
    });
}

module.exports = { syncMail, resolveAppleMailIndexPath, buildMailStatus };
module.exports.isImapConfigured = hasImapConfig;
module.exports.isGmailConfigured = hasGmailConfig;
