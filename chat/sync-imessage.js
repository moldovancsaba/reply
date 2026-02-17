const { addDocuments } = require('./vector-store.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { withDefaults, readSettings } = require('./settings-store.js');

const DB_PATH = path.join(__dirname, 'data', 'chat.db');
const STATE_FILE = path.join(__dirname, 'data', 'sync_state.json');
const statusManager = require('./status-manager.js');

function updateStatus(status) {
    statusManager.update('imessage', status);
}

// Ensure DB exists
if (!fs.existsSync(DB_PATH)) {
    console.error("Database not found. Please copy chat.db to chat/data/");
    updateStatus({ state: "error", message: "Database not found" });
    process.exit(1);
}

const db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY);

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
    updateStatus({ state: "running", message: "Opening message database..." });
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
        LIMIT ${batchLimit}
    `;

    return new Promise((resolve, reject) => {
        db.all(query, [state.lastProcessedId], async (err, rows) => {
            if (err) {
                updateStatus({ state: "error", message: err.message });
                return reject(err);
            }
            if (rows.length === 0) {
                console.log("Everything is already in sync!");

                // Don't set 'processed' - server reads from sync_state.json
                updateStatus({
                    state: "idle",
                    lastSync: new Date().toISOString()
                });
                return resolve();
            }

            console.log(`Processing ${rows.length} new messages...`);
            // Don't update 'processed' during intermediate steps - only at the end
            updateStatus({ state: "running", progress: 20, message: `Processing ${rows.length} new messages...` });

            const docs = rows.map(row => ({
                id: `msg-${row.ROWID}`,
                text: `[${convertDate(row.date)}] ${row.is_from_me ? 'Me' : row.handle_id}: ${row.text}`,
                source: 'iMessage',
                path: `imessage://${row.handle_id || 'unknown'}`
            }));

            try {
                updateStatus({ state: "running", progress: 50, message: `Vectorizing ${docs.length} messages...` });
                await addDocuments(docs);

                // Update LastContacted in the store
                const contactStore = require('./contact-store.js');
                rows.forEach(row => {
                    contactStore.updateLastContacted(row.handle_id, convertDate(row.date), { channel: 'imessage' });
                });

                const maxId = rows[rows.length - 1].ROWID;
                saveState(maxId);
                console.log(`Sync complete. Last ID: ${maxId}`);

                // Don't set 'processed' - server reads from sync_state.json
                updateStatus({
                    state: "idle",
                    lastSync: new Date().toISOString()
                });
                resolve();
            } catch (syncErr) {
                updateStatus({ state: "error", message: syncErr.message });
                reject(syncErr);
            }
        });
    });
}

if (require.main === module) {
    sync().then(() => {
        db.close();
    }).catch(err => {
        console.error("Sync failed:", err);
        updateStatus({ state: "error", message: err.message });
        db.close();
    });
}

module.exports = { sync };
