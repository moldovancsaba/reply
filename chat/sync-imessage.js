const { addDocuments } = require('./vector-store.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { withDefaults, readSettings } = require('./settings-store.js');
const { resolveIMessageDbPath } = require('./imessage-db-path.js');
const { ensureDataHome, dataPath } = require('./app-paths.js');
const { execFile } = require('child_process');
ensureDataHome();

const DB_PATH = resolveIMessageDbPath();
const STATE_FILE = dataPath('sync_state.json');
const MIRROR_STATE_FILE = dataPath('imessage_mirror_backfill_state.json');
const statusManager = require('./status-manager.js');

/** @type {import('sqlite3').Database|null|false} false = open failed permanently this process */
let _imessageDb = null;

function updateStatus(status) {
    statusManager.update('imessage', status);
}

function nowIso() {
    return new Date().toISOString();
}

function markAttempt(status) {
    let current = {};
    try {
        current = statusManager.get('imessage') || {};
    } catch {
        current = {};
    }
    return {
        lastSuccessfulSync: current.lastSuccessfulSync || current.lastSync || null,
        ...status,
        lastAttemptedSync: nowIso()
    };
}

function readCurrentProcessed() {
    try {
        const cur = statusManager.get('imessage') || {};
        const n = Number(cur.processed);
        return Number.isFinite(n) && n >= 0 ? n : 0;
    } catch {
        return 0;
    }
}

function getIMessageAccessError() {
    if (!fs.existsSync(DB_PATH)) {
        return process.platform === "darwin"
            ? `iMessage database missing at ${DB_PATH}. Grant Full Disk Access to the protected-data helper used by {reply}, or set REPLY_IMESSAGE_DB_PATH in chat/.env to a readable chat.db.`
            : `Database missing at ${DB_PATH}. Place a stub chat.db under the app-owned reply data home or set REPLY_IMESSAGE_DB_PATH.`;
    }
    try {
        fs.accessSync(DB_PATH, fs.constants.R_OK);
        return null;
    } catch (err) {
        return process.platform === "darwin"
            ? `Cannot read iMessage database at ${DB_PATH}. Grant Full Disk Access to the protected-data helper used by {reply}, or set REPLY_IMESSAGE_DB_PATH in chat/.env to a readable chat.db.`
            : `Cannot read database at ${DB_PATH}: ${err.message}`;
    }
}

/**
 * Lazily open Apple's chat.db (readonly). Never runs at require() time — avoids crashing
 * the hub when Messages DB is missing or blocked by TCC (hub must stay up for the UI).
 */
function getIMessageReadonlyDb() {
    if (_imessageDb === false) return null;
    if (_imessageDb) return _imessageDb;

    const accessError = getIMessageAccessError();
    if (accessError) {
        const hint = accessError;
        console.warn("[sync-imessage]", hint);
        updateStatus(markAttempt({ state: "error", message: hint, lastSync: null }));
        _imessageDb = false;
        return null;
    }

    const database = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            console.error("[sync-imessage] Cannot open iMessage database:", err.message);
            updateStatus(markAttempt({ state: "error", message: err.message, lastSync: null }));
            if (_imessageDb === database) _imessageDb = false;
        }
    });
    database.on("error", (e) => {
        console.error("[sync-imessage] SQLite error:", e.message);
    });
    _imessageDb = database;
    return database;
}

/**
 * Load sync state to resume from last message.
 */
function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    return { lastProcessedId: 0 };
}

function saveState(lastId) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastProcessedId: lastId, lastSync: new Date().toISOString() }, null, 2));
}

function loadMirrorState() {
    if (fs.existsSync(MIRROR_STATE_FILE)) {
        try {
            const parsed = JSON.parse(fs.readFileSync(MIRROR_STATE_FILE, 'utf8'));
            return {
                lastProcessedId: Math.max(0, Number(parsed?.lastProcessedId) || 0),
                sourceMaxRowId: Math.max(0, Number(parsed?.sourceMaxRowId) || 0),
                complete: Boolean(parsed?.complete),
                updatedAt: parsed?.updatedAt || null
            };
        } catch {
            // Fall through to default state.
        }
    }
    return {
        lastProcessedId: 0,
        sourceMaxRowId: 0,
        complete: false,
        updatedAt: null
    };
}

function saveMirrorState(next) {
    const state = {
        lastProcessedId: Math.max(0, Number(next?.lastProcessedId) || 0),
        sourceMaxRowId: Math.max(0, Number(next?.sourceMaxRowId) || 0),
        complete: Boolean(next?.complete),
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(MIRROR_STATE_FILE, JSON.stringify(state, null, 2));
    return state;
}

function convertDate(value) {
    if (!value) return null;
    let seconds = value;
    if (value > 100000000000000) seconds = value / 1000000000;
    const UNIX_EPOCH_OFFSET = 978307200;
    return new Date((seconds + UNIX_EPOCH_OFFSET) * 1000).toISOString();
}

async function getSourceMaxRowId(db) {
    return new Promise((resolve, reject) => {
        db.get("SELECT MAX(ROWID) AS maxRowId FROM message", (err, row) => {
            if (err) return reject(err);
            resolve(Math.max(0, Number(row?.maxRowId) || 0));
        });
    });
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
    const { stdout } = await execFileAsync(helperPath, [
        "export-imessage",
        "--db-path", DB_PATH,
        "--after-rowid", String(afterRowId),
        "--limit", String(limit)
    ], {
        maxBuffer: 10 * 1024 * 1024
    });
    return JSON.parse(stdout || "[]");
}

function normalizeAttachmentList(attachments) {
    return (attachments || [])
        .map((item) => {
            const name = String(item?.name || item?.filename || "").trim();
            const id = String(item?.guid || "").trim();
            const mime = String(item?.mime || item?.mimeType || "").trim();
            const size = Number(item?.size ?? item?.totalBytes);
            const out = {};
            if (name) out.name = name;
            if (id) out.id = id;
            if (mime) out.mime = mime;
            if (Number.isFinite(size) && size >= 0) out.size = size;
            return Object.keys(out).length ? out : null;
        })
        .filter(Boolean);
}

function summarizeAttachmentName(mime = "") {
    const lower = String(mime || "").toLowerCase();
    if (lower.startsWith("image/")) return "Image";
    if (lower.startsWith("video/")) return "Video";
    if (lower.startsWith("audio/")) return "Audio";
    if (lower === "application/pdf") return "PDF";
    return "File";
}

function buildMessageBody({ text, subject, attachments }) {
    const normalizedAttachments = normalizeAttachmentList(attachments);
    let body = String(text || "").trim();
    if (!body) {
        body = String(subject || "").trim();
    }
    if (!body && normalizedAttachments.length > 0) {
        const first = normalizedAttachments[0]?.name || summarizeAttachmentName(normalizedAttachments[0]?.mime);
        body = normalizedAttachments.length === 1 ? `[Attachment: ${first}]` : `[Attachments: ${normalizedAttachments.length}]`;
    }
    if (normalizedAttachments.length > 0) {
        body += `\n\n[ATTACHMENTS: ${JSON.stringify(normalizedAttachments)}]`;
    }
    return body.trim();
}

function normalizeHelperRows(rows) {
    return (rows || []).map((row) => ({
        ROWID: Number(row.rowID || row.ROWID || 0),
        text: String(row.text || "").trim(),
        date: Number(row.date || 0),
        is_from_me: row.isFromMe ? 1 : 0,
        handle_id: row.handleID || row.handle_id || 'unknown',
        service: row.service || 'iMessage'
    })).filter((row) => row.ROWID > 0 && row.text);
}

function normalizeIMessageParticipant(raw) {
    return String(raw || '').trim();
}

function loadChatMetadataForRows(db, rowIds = []) {
    const ids = Array.from(new Set((rowIds || []).map((value) => Number(value) || 0).filter(Boolean)));
    if (!ids.length) return Promise.resolve(new Map());
    const placeholders = ids.map(() => '?').join(', ');
    const query = `
        SELECT
            m.ROWID AS rowid,
            c.guid AS chat_guid,
            c.chat_identifier AS chat_identifier,
            c.display_name AS chat_display_name,
            c.group_id AS group_id,
            c.service_name AS chat_service_name,
            GROUP_CONCAT(DISTINCT chh.id) AS participant_handles
        FROM message m
        LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
        LEFT JOIN chat c ON c.ROWID = cmj.chat_id
        LEFT JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
        LEFT JOIN handle chh ON chh.ROWID = chj.handle_id
        WHERE m.ROWID IN (${placeholders})
        GROUP BY m.ROWID, c.guid, c.chat_identifier, c.display_name, c.group_id, c.service_name
    `;
    return new Promise((resolve, reject) => {
        db.all(query, ids, (err, rows) => {
            if (err) return reject(err);
            const out = new Map();
            for (const row of rows || []) {
                out.set(Number(row.rowid), {
                    chatGuid: String(row.chat_guid || '').trim() || null,
                    chatIdentifier: String(row.chat_identifier || '').trim() || null,
                    chatDisplayName: String(row.chat_display_name || '').trim() || null,
                    groupId: String(row.group_id || '').trim() || null,
                    serviceName: String(row.chat_service_name || '').trim() || null,
                    participantHandles: String(row.participant_handles || '')
                        .split(',')
                        .map((value) => normalizeIMessageParticipant(value))
                        .filter(Boolean)
                });
            }
            resolve(out);
        });
    });
}

async function hydrateRowsWithChatMetadata(db, rows = []) {
    const metadataByRowId = await loadChatMetadataForRows(db, rows.map((row) => row.ROWID));
    return rows.map((row) => ({
        ...row,
        ...(metadataByRowId.get(Number(row.ROWID)) || {})
    }));
}

function loadRowsViaSqlite(db, afterRowId, limit) {
    const query = `
        SELECT 
            message.ROWID, 
            message.text, 
            message.subject,
            message.date, 
            message.is_from_me, 
            message.service,
            handle.id as handle_id,
            message.cache_has_attachments,
            chat.guid AS chat_guid,
            chat.chat_identifier AS chat_identifier,
            chat.display_name AS chat_display_name,
            chat.group_id AS group_id,
            chat.service_name AS chat_service_name,
            GROUP_CONCAT(DISTINCT chat_handle.id) AS participant_handles
        FROM message 
        LEFT JOIN handle ON message.handle_id = handle.ROWID 
        LEFT JOIN chat_message_join ON chat_message_join.message_id = message.ROWID
        LEFT JOIN chat ON chat.ROWID = chat_message_join.chat_id
        LEFT JOIN chat_handle_join ON chat_handle_join.chat_id = chat.ROWID
        LEFT JOIN handle AS chat_handle ON chat_handle.ROWID = chat_handle_join.handle_id
        WHERE message.ROWID > ?
        AND (
            (message.text IS NOT NULL AND message.text != '') OR
            (message.subject IS NOT NULL AND message.subject != '') OR
            message.cache_has_attachments = 1
        )
        GROUP BY
            message.ROWID,
            message.text,
            message.subject,
            message.date,
            message.is_from_me,
            message.service,
            handle.id,
            message.cache_has_attachments,
            chat.guid,
            chat.chat_identifier,
            chat.display_name,
            chat.group_id,
            chat.service_name
        ORDER BY message.ROWID ASC
        LIMIT ?
    `;

    return new Promise((resolve, reject) => {
        db.all(query, [afterRowId, limit], (err, rows) => {
            if (err) {
                return reject(err);
            }
            const normalized = rows.map((row) => ({
                ROWID: row.ROWID,
                text: buildMessageBody({
                    text: row.text,
                    subject: row.subject,
                    attachments: row.cache_has_attachments ? [{ mime: "", name: "Attachment" }] : []
                }),
                date: row.date,
                is_from_me: row.is_from_me,
                handle_id: row.handle_id || 'unknown',
                service: row.service || 'iMessage',
                chatGuid: row.chat_guid || null,
                chatIdentifier: row.chat_identifier || null,
                chatDisplayName: row.chat_display_name || null,
                groupId: row.group_id || null,
                serviceName: row.chat_service_name || null,
                participantHandles: String(row.participant_handles || '').split(',').map((value) => normalizeIMessageParticipant(value)).filter(Boolean),
            })).filter((row) => row.text);
            resolve(normalized);
        });
    });
}

async function updateContactActivityFromRows(rows = []) {
    const contactStore = require('./contact-store.js');
    for (const row of rows) {
        const date = convertDate(row.date);
        void contactStore.updateLastContacted(row.handle_id, date, { channel: 'imessage' }).catch((error) => {
            console.warn("[sync-imessage] Failed to update last-contacted:", error.message);
        });
        if (!row.is_from_me && row.handle_id) {
            await contactStore.markChannelInboundVerified(row.handle_id, row.handle_id, date);
        }
    }
}

async function backfillUnifiedStore(options = {}) {
    const db = getIMessageReadonlyDb();
    if (!db) {
        const msg = fs.existsSync(DB_PATH)
            ? `Cannot open iMessage database. Grant Full Disk Access to the protected-data helper used by {reply} or set REPLY_IMESSAGE_DB_PATH: ${DB_PATH}`
            : `iMessage database not found: ${DB_PATH}`;
        throw new Error(msg);
    }

    const batchLimit = Math.max(100, Math.min(Number(options.batchLimit) || 5000, 25000));
    const maxBatches = Math.max(1, Math.min(Number(options.maxBatches) || 1, 200));
    const sourceMaxRowId = await getSourceMaxRowId(db);
    let state = loadMirrorState();
    let cursor = options.restart === true
        ? 0
        : Math.max(0, Number(state.lastProcessedId) || 0);

    const { saveMessages } = require('./message-store.js');
    let saved = 0;
    let batches = 0;

    while (batches < maxBatches && cursor < sourceMaxRowId) {
        let rows = null;
        try {
            const helperRows = await loadRowsViaHelper(cursor, batchLimit);
            if (helperRows) {
                rows = await hydrateRowsWithChatMetadata(db, normalizeHelperRows(helperRows));
            }
        } catch (error) {
            console.warn("[sync-imessage] helper store backfill failed, falling back to sqlite3:", error.message);
        }
        if (!rows) {
            rows = await loadRowsViaSqlite(db, cursor, batchLimit);
        }
        if (!rows.length) {
            cursor = sourceMaxRowId;
            break;
        }

        const unifiedDocs = rows.map((row) => ({
            id: `msg-${row.ROWID}`,
            text: row.text,
            source: 'iMessage',
            handle: row.handle_id || 'unknown',
            timestamp: convertDate(row.date),
            path: `imessage://${row.handle_id || 'unknown'}`,
            is_from_me: row.is_from_me === 1,
            metadata: {
                providerMessageKey: String(row.ROWID || ''),
                channel: 'imessage',
                externalThreadKey: row.chatGuid || row.chatIdentifier || row.groupId || row.handle_id || null,
                externalThreadKind: Array.isArray(row.participantHandles) && row.participantHandles.length > 1 ? 'group' : 'direct',
                externalThreadTitle: row.chatDisplayName || null,
                senderIdentity: row.handle_id || null,
                participantIdentities: Array.isArray(row.participantHandles) && row.participantHandles.length
                    ? row.participantHandles
                    : (row.handle_id ? [row.handle_id] : []),
                recipientIdentities: row.handle_id ? [row.handle_id] : [],
            }
        }));
        await saveMessages(unifiedDocs);
        await updateContactActivityFromRows(rows);

        cursor = rows[rows.length - 1].ROWID;
        saved += unifiedDocs.length;
        batches += 1;
        state = saveMirrorState({
            lastProcessedId: cursor,
            sourceMaxRowId,
            complete: cursor >= sourceMaxRowId
        });
    }

    if (cursor >= sourceMaxRowId) {
        state = saveMirrorState({
            lastProcessedId: sourceMaxRowId,
            sourceMaxRowId,
            complete: true
        });
    }

    return {
        saved,
        batches,
        cursor: state.lastProcessedId,
        sourceMaxRowId,
        complete: Boolean(state.complete)
    };
}

/**
 * Sync messages in batches.
 * @returns {Promise<void>}
 */
async function sync() {
    updateStatus(markAttempt({ state: "running", message: "Opening message database..." }));
    const state = loadState();
    console.log(`Starting iMessage sync from ROWID > ${state.lastProcessedId}...`);

    const settings = withDefaults(readSettings());
    const batchLimit = Math.max(1, Math.min(Number(settings?.worker?.quantities?.imessage) || 1000, 5000));
    let rows = null;
    try {
        const helperRows = await loadRowsViaHelper(state.lastProcessedId, batchLimit);
        if (helperRows) {
            const db = getIMessageReadonlyDb();
            rows = db ? await hydrateRowsWithChatMetadata(db, normalizeHelperRows(helperRows)) : normalizeHelperRows(helperRows);
        }
    } catch (error) {
        console.warn("[sync-imessage] helper export failed, falling back to sqlite3:", error.message);
    }

    if (!rows) {
        const db = getIMessageReadonlyDb();
        if (!db) {
            const msg = fs.existsSync(DB_PATH)
                ? `Cannot open iMessage database. Grant Full Disk Access to the protected-data helper used by {reply} or set REPLY_IMESSAGE_DB_PATH: ${DB_PATH}`
                : `iMessage database not found: ${DB_PATH}`;
            updateStatus(markAttempt({ state: "error", message: msg, lastSync: null }));
            throw new Error(msg);
        }
        rows = await loadRowsViaSqlite(db, state.lastProcessedId, batchLimit);
    }

    if (rows.length === 0) {
        console.log("Everything is already in sync!");

        updateStatus({
            state: "idle",
            message: "iMessage is already in sync.",
            lastSync: nowIso(),
            lastSuccessfulSync: nowIso(),
            lastAttemptedSync: nowIso(),
            processed: readCurrentProcessed()
        });
        return;
    }

    console.log(`Processing ${rows.length} new messages...`);
    updateStatus(markAttempt({ state: "running", progress: 20, message: `Processing ${rows.length} new messages...` }));

    const docs = rows.map(row => ({
        id: `msg-${row.ROWID}`,
        text: `[${convertDate(row.date)}] ${row.is_from_me ? 'Me' : row.handle_id}: ${row.text}`,
        source: 'iMessage',
        path: `imessage://${row.handle_id || 'unknown'}`
    }));

    try {
        updateStatus(markAttempt({ state: "running", progress: 50, message: `Vectorizing ${docs.length} messages...` }));

        await addDocuments(docs);

        const { saveMessages } = require('./message-store.js');
        const unifiedDocs = rows.map(row => ({
            id: `msg-${row.ROWID}`,
            text: row.text,
            source: 'iMessage',
            handle: row.handle_id || 'unknown',
            timestamp: convertDate(row.date),
            path: `imessage://${row.handle_id || 'unknown'}`,
            is_from_me: row.is_from_me === 1,
            metadata: {
                providerMessageKey: String(row.ROWID || ''),
                channel: 'imessage',
                externalThreadKey: row.chatGuid || row.chatIdentifier || row.groupId || row.handle_id || null,
                externalThreadKind: Array.isArray(row.participantHandles) && row.participantHandles.length > 1 ? 'group' : 'direct',
                externalThreadTitle: row.chatDisplayName || null,
                senderIdentity: row.handle_id || null,
                participantIdentities: Array.isArray(row.participantHandles) && row.participantHandles.length
                    ? row.participantHandles
                    : (row.handle_id ? [row.handle_id] : []),
                recipientIdentities: row.handle_id ? [row.handle_id] : [],
            }
        }));
        await saveMessages(unifiedDocs);

        await updateContactActivityFromRows(rows);

        const maxId = rows[rows.length - 1].ROWID;
        saveState(maxId);
        console.log(`Sync complete. Last ID: ${maxId}`);

        const nextProcessed = readCurrentProcessed() + docs.length;
        updateStatus({
            state: "idle",
            message: `Synced ${docs.length} iMessage records.`,
            lastSync: nowIso(),
            lastSuccessfulSync: nowIso(),
            lastAttemptedSync: nowIso(),
            processed: nextProcessed
        });
    } catch (syncErr) {
        updateStatus(markAttempt({ state: "error", message: syncErr.message, lastSync: null }));
        throw syncErr;
    }
}

if (require.main === module) {
    sync()
        .then(() => {
            const d = getIMessageReadonlyDb();
            if (d && typeof d.close === "function") d.close();
        })
        .catch((err) => {
            console.error("Sync failed:", err);
            updateStatus(markAttempt({ state: "error", message: err.message, lastSync: null }));
            const d = getIMessageReadonlyDb();
            if (d && typeof d.close === "function") d.close();
        });
}

module.exports = {
    sync,
    getIMessageReadonlyDb,
    getIMessageAccessError,
    convertDate,
    backfillUnifiedStore
};
