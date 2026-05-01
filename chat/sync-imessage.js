const { addDocuments } = require('./vector-store.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { withDefaults, readSettings } = require('./settings-store.js');
const { resolveIMessageDbPath } = require('./imessage-db-path.js');
const { ensureDataHome, dataPath } = require('./app-paths.js');
ensureDataHome();

const DB_PATH = resolveIMessageDbPath();
const STATE_FILE = dataPath('sync_state.json');
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

function convertDate(value) {
    if (!value) return null;
    let seconds = value;
    if (value > 100000000000000) seconds = value / 1000000000;
    const UNIX_EPOCH_OFFSET = 978307200;
    return new Date((seconds + UNIX_EPOCH_OFFSET) * 1000).toISOString();
}

/**
 * Sync messages in batches.
 * @returns {Promise<void>}
 */
async function sync() {
    const db = getIMessageReadonlyDb();
    if (!db) {
        const msg = fs.existsSync(DB_PATH)
            ? `Cannot open iMessage database. Grant Full Disk Access to the protected-data helper used by {reply} or set REPLY_IMESSAGE_DB_PATH: ${DB_PATH}`
            : `iMessage database not found: ${DB_PATH}`;
        updateStatus(markAttempt({ state: "error", message: msg, lastSync: null }));
        throw new Error(msg);
    }

    updateStatus(markAttempt({ state: "running", message: "Opening message database..." }));
    const state = loadState();
    console.log(`Starting iMessage sync from ROWID > ${state.lastProcessedId}...`);

    const settings = withDefaults(readSettings());
    const batchLimit = Math.max(1, Math.min(Number(settings?.worker?.quantities?.imessage) || 1000, 5000));

    const query = `
        SELECT 
            message.ROWID, 
            message.text, 
            message.date, 
            message.is_from_me, 
            handle.id as handle_id 
        FROM message 
        LEFT JOIN handle ON message.handle_id = handle.ROWID 
        WHERE message.ROWID > ?
        AND message.text IS NOT NULL 
        AND message.text != ""
        ORDER BY message.ROWID ASC
        LIMIT ?
    `;

    return new Promise((resolve, reject) => {
        db.all(query, [state.lastProcessedId, batchLimit], async (err, rows) => {
            if (err) {
                updateStatus({ state: "error", message: err.message });
                return reject(err);
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
                return resolve();
            }

            console.log(`Processing ${rows.length} new messages...`);
            // Don't update 'processed' during intermediate steps - only at the end
            updateStatus(markAttempt({ state: "running", progress: 20, message: `Processing ${rows.length} new messages...` }));

            const docs = rows.map(row => ({
                id: `msg-${row.ROWID}`,
                text: `[${convertDate(row.date)}] ${row.is_from_me ? 'Me' : row.handle_id}: ${row.text}`,
                source: 'iMessage',
                path: `imessage://${row.handle_id || 'unknown'}`
            }));

            try {
                updateStatus(markAttempt({ state: "running", progress: 50, message: `Vectorizing ${docs.length} messages...` }));

                // 1. Vectorize for search
                await addDocuments(docs);

                // 2. Save to unified chat.db
                const { saveMessages } = require('./message-store.js');
                const unifiedDocs = rows.map(row => ({
                    id: `msg-${row.ROWID}`,
                    text: row.text,
                    source: 'iMessage',
                    handle: row.handle_id || 'unknown',
                    timestamp: convertDate(row.date),
                    path: `imessage://${row.handle_id || 'unknown'}`,
                    is_from_me: row.is_from_me === 1
                }));
                await saveMessages(unifiedDocs);

                // Update LastContacted and Inbound Verified in the store
                const contactStore = require('./contact-store.js');
                for (const row of rows) {
                    const date = convertDate(row.date);
                    contactStore.updateLastContacted(row.handle_id, date, { channel: 'imessage' });
                    if (!row.is_from_me && row.handle_id) {
                        await contactStore.markChannelInboundVerified(row.handle_id, row.handle_id, date);
                    }
                }

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
                resolve();
            } catch (syncErr) {
                updateStatus(markAttempt({ state: "error", message: syncErr.message, lastSync: null }));
                reject(syncErr);
            }
        });
    });
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

module.exports = { sync, getIMessageReadonlyDb, getIMessageAccessError };
