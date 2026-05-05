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

const APPLE_MAIL_STATE_FILE = dataPath('apple_mail_sync_state.json');
const APPLE_MAIL_INDEX_PATH = path.join(process.env.HOME || '', 'Library/Mail/V10/MailData/Envelope Index');

function updateStatus(status) {
    statusManager.update('mail', status);
}

function withMailConnector(status, connector) {
    return { ...status, connector };
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
    return new sqlite3.Database(APPLE_MAIL_INDEX_PATH, sqlite3.OPEN_READONLY);
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
    return fs.existsSync(APPLE_MAIL_INDEX_PATH);
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
 * whether additional backfill work remains.
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
            updateStatus(withMailConnector({ state: "error", message: `Gmail failed, falling back to local mail: ${e.message}` }, "gmail"));
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
            updateStatus(withMailConnector({ state: 'error', message: `IMAP ${acct.label || acct.id}: ${e.message}` }, 'imap'));
        }
    }

    if (hasImapConfig() || extra.length > 0) {
        return { added: imapTotal, hasMore: false };
    }

    if (!appleMailIndexExists()) {
        const msg = `Apple Mail index not found at ${APPLE_MAIL_INDEX_PATH}`;
        updateStatus(withMailConnector({ state: "error", message: msg }, "apple_mail"));
        throw new Error(msg);
    }

    console.log("Synchronizing Apple Mail index...");
    updateStatus(withMailConnector({ state: "running", message: "Reading Apple Mail index..." }, "apple_mail"));

    let db = null;
    try {
        db = openAppleMailIndex();
        db.run("PRAGMA journal_mode = WAL");
        db.run("PRAGMA busy_timeout = 5000");
        const state = loadAppleMailState();
        const sourceMaxRowId = await getAppleMailSourceMaxRowId(db);
        const selfEmails = await collectAppleMailSelfEmails(db);
        const maxMessages = Math.max(100, Math.min(Number(settings?.worker?.quantities?.mail) || 1000, 5000));

        console.log(`Processing Apple Mail index rows > ${state.lastRowId}...`);
        updateStatus(withMailConnector({ state: "running", progress: 20, message: `Processing Apple Mail index rows > ${state.lastRowId}...` }, "apple_mail"));

        let savedCount = 0;
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
        const filtered = rows.filter((row) => !isExcludedAppleMailbox(row.mailbox_url)).slice(0, maxMessages);
        const recipientMap = await loadAppleMailRecipientMap(db, filtered.map((row) => row.rowid));
        const docs = [];
        const unifiedDocs = [];
        let lastProcessedRowId = state.lastRowId;

        for (const row of filtered) {
            lastProcessedRowId = Math.max(lastProcessedRowId, Number(row.rowid) || 0);
            const recipients = recipientMap.get(row.rowid) || [];
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

            contactStore.updateLastContacted(cleanHandle, isoDate, { channel: 'email' });
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
            updateStatus(withMailConnector({
                state: "running",
                progress: 80,
                message: `Saved ${savedCount} Apple Mail index rows...`
            }, "apple_mail"));
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

            const currentStatus = statusManager.get('mail');
            const currentCount = currentStatus.processed || 0;

            updateStatus(withMailConnector({ state: "idle", lastSync: new Date().toISOString(), processed: currentCount + savedCount }, "apple_mail"));
        } else {
            const currentStatus = statusManager.get('mail');
            const currentCount = currentStatus.processed || 0;

            updateStatus(withMailConnector({ state: "idle", lastSync: new Date().toISOString(), processed: currentCount, message: "No new Apple Mail index rows found" }, "apple_mail"));
        }

        return { added: savedCount, hasMore: nextState.lastRowId < sourceMaxRowId };

    } catch (e) {
        console.error("Mail Sync Error:", e);
        updateStatus(withMailConnector({ state: "error", message: e.message }, "apple_mail"));
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

module.exports = { syncMail };
module.exports.isImapConfigured = hasImapConfig;
module.exports.isGmailConfigured = hasGmailConfig;
